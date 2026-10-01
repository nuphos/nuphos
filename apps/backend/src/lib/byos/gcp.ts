import { ClusterManagerClient } from '@google-cloud/container'
import { Impersonated } from 'google-auth-library'

import { config } from '@/config'
import { AppError } from '@/lib/errors'

import { gcpServiceDisabledInfo } from './gcp-errors'
import { gcpWifConfigured, gcpWifSourceClient } from './gcp-wif'
import { renderKubeconfig } from './kubeconfig'

import type { KubeconfigResult } from './kubeconfig'
import type { ClusterResult } from './types'

export const GCP_SCOPES = ['https://www.googleapis.com/auth/cloud-platform']

export type GcpHandle = {
  serviceAccountEmail: string
  projectId: string
  teamId: string
}

export const GKE_SERVICE = 'container.googleapis.com'
export const GKE_SERVICE_TITLE = 'Kubernetes Engine API'
const LIST_CLUSTERS_OPERATION = 'container.clusters.list'

/**
 * Mint an impersonated client for a customer's service account.
 *
 * Workload identity federation holds no long-lived key: we federate as this team
 * and impersonate the customer's service account directly. There is deliberately
 * no shared connector service account, delegation, or JSON-key fallback.
 */
export function impersonateSa(serviceAccountEmail: string, teamId: string): Promise<Impersonated> {
  if (!gcpWifConfigured()) {
    return Promise.reject(
      new AppError(
        503,
        'gcp_federation_unavailable',
        'GCP workload identity federation is not configured on this server.',
      ),
    )
  }
  const lifetime = config.byos.gcp.tokenLifetimeSec

  return Promise.resolve(
    new Impersonated({
      sourceClient: gcpWifSourceClient(teamId),
      targetPrincipal: serviceAccountEmail,
      targetScopes: GCP_SCOPES,
      lifetime,
    }),
  )
}

/**
 * Returns the AppError to throw, or null when the failure is not one we can
 * name — the caller then reports it as an inline binding error.
 */
export function classifyListClustersError(e: unknown, handle: GcpHandle): AppError | null {
  const code = (e as { code?: number }).code
  const message = e instanceof Error ? e.message : String(e)

  const disabled = gcpServiceDisabledInfo(e, {
    service: GKE_SERVICE,
    serviceTitle: GKE_SERVICE_TITLE,
    projectId: handle.projectId,
  })

  if (disabled) {
    return new AppError(
      502,
      'gcp_api_disabled',
      `${disabled.serviceTitle} is not enabled in project ${disabled.project}. Enable it with \`${disabled.enableCommand}\`, then retry.`,
      {
        provider: 'gcp',
        operation: LIST_CLUSTERS_OPERATION,
        serviceAccountEmail: handle.serviceAccountEmail,
        service: disabled.service,
        serviceTitle: disabled.serviceTitle,
        project: disabled.project,
        activationUrl: disabled.activationUrl,
        enableCommand: disabled.enableCommand,
        upstreamMessage: message,
      },
    )
  }

  if (code === 7 || /permission|forbidden|denied/i.test(message)) {
    return new AppError(
      403,
      'gcp_service_account_permission_denied',
      `The selected GCP service account does not have permission to ${LIST_CLUSTERS_OPERATION}.`,
      {
        provider: 'gcp',
        operation: LIST_CLUSTERS_OPERATION,
        serviceAccountEmail: handle.serviceAccountEmail,
        upstreamMessage: message,
      },
    )
  }

  return null
}

export async function listGkeClusters(
  handle: GcpHandle,
): Promise<{ clusters: ClusterResult[]; errors: { message: string }[] }> {
  if (!gcpWifConfigured()) {
    return {
      clusters: [],
      errors: [{ message: 'GCP BYOS connector is not configured' }],
    }
  }

  try {
    const impersonated = await impersonateSa(handle.serviceAccountEmail, handle.teamId)
    const containerClient = new ClusterManagerClient({
      authClient: impersonated as never,
    })
    const [response] = await containerClient.listClusters({
      parent: `projects/${handle.projectId}/locations/-`,
    })

    const clusters: ClusterResult[] = (response.clusters ?? []).map((c) => ({
      provider: 'gcp' as const,
      name: c.name ?? '',
      region: c.location ?? '',
      endpoint: c.endpoint ?? undefined,
      caBase64: c.masterAuth?.clusterCaCertificate ?? undefined,
      status: c.status ? String(c.status) : undefined,
      version: c.currentMasterVersion ?? undefined,
      createdAt: c.createTime ? new Date(c.createTime) : undefined,
      gcpServiceAccountEmail: handle.serviceAccountEmail,
      gcpProjectId: handle.projectId,
      gcpResourceName: `projects/${handle.projectId}/locations/${String(c.location)}/clusters/${String(c.name)}`,
    }))

    return { clusters, errors: [] }
  } catch (e) {
    const appError = classifyListClustersError(e, handle)

    if (appError) throw appError

    return { clusters: [], errors: [{ message: e instanceof Error ? e.message : String(e) }] }
  }
}

export type GkeAdminAccess = {
  clusterName: string
  /** Already prefixed with `https://`. */
  endpoint: string
  /** Base64-encoded PEM CA bundle. */
  caBase64: string
  /** Impersonated GCP SA access token — admin-equivalent on the K8s API. */
  adminToken: string
  expiresAt: Date
}

/**
 * Resolve a GKE cluster's API endpoint, CA, and an admin-equivalent K8s
 * access token (the impersonated SA's token, scoped via cloud-platform).
 *
 * Returns null when the cluster doesn't exist; throws on any other error.
 *
 * Used by the kubeconfig routes to return the impersonated service account's
 * admin-equivalent cluster credentials.
 */
export async function getGkeAdminAccess(
  handle: GcpHandle,
  location: string,
  clusterName: string,
): Promise<GkeAdminAccess | null> {
  const impersonated = await impersonateSa(handle.serviceAccountEmail, handle.teamId)
  const containerClient = new ClusterManagerClient({
    authClient: impersonated as never,
  })

  let cluster

  try {
    const [c] = await containerClient.getCluster({
      name: `projects/${handle.projectId}/locations/${location}/clusters/${clusterName}`,
    })

    cluster = c
  } catch (e) {
    const code = (e as { code?: number }).code

    if (code === 5 /* NOT_FOUND */) return null
    throw e
  }
  if (!cluster.endpoint || !cluster.masterAuth?.clusterCaCertificate) {
    throw new Error('Cluster missing endpoint or CA certificate')
  }

  const tokenResp = await impersonated.getAccessToken()

  if (!tokenResp.token) throw new Error('Failed to obtain impersonated access token')

  return {
    clusterName,
    endpoint: `https://${cluster.endpoint}`,
    caBase64: cluster.masterAuth.clusterCaCertificate,
    adminToken: tokenResp.token,
    expiresAt: new Date(Date.now() + config.byos.gcp.tokenLifetimeSec * 1000),
  }
}

export async function generateGkeKubeconfig(
  handle: GcpHandle,
  location: string,
  clusterName: string,
): Promise<KubeconfigResult | null> {
  const access = await getGkeAdminAccess(handle, location, clusterName)

  if (!access) return null
  const kubeconfig = renderKubeconfig({
    clusterName: access.clusterName,
    endpoint: access.endpoint,
    caBase64: access.caBase64,
    token: access.adminToken,
  })

  return {
    kubeconfig,
    expiresAt: access.expiresAt,
  }
}
