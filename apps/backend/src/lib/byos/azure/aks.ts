import { AKS_API_VERSION, armRequest } from './core'

import type { AzureHandle } from './core'
import type { KubeconfigResult } from '../kubeconfig'
import type { ClusterResult } from '../types'

type AksListResponse = {
  value?: {
    id?: string
    name?: string
    location?: string
    properties?: { kubernetesVersion?: string; provisioningState?: string }
  }[]
}

/** Parse the resource-group segment out of an ARM resource id. */
function resourceGroupFromId(id: string | undefined): string | undefined {
  return id?.match(/\/resourceGroups\/([^/]+)\//i)?.[1]
}

/**
 * List the subscription's AKS managed clusters. Mirrors `listEksClusters`: the
 * ARM list endpoint already spans every region, so a single call returns them
 * all (no per-region sweep like the STS clouds need). Stamps the resource group
 * onto each cluster — the kubeconfig fetch needs it.
 */
export async function listAksClusters(
  handle: AzureHandle,
): Promise<{ clusters: ClusterResult[]; errors: { message: string }[] }> {
  const resp = await armRequest<AksListResponse>(
    handle,
    `/subscriptions/${handle.subscriptionId}/providers/Microsoft.ContainerService/managedClusters`,
    { apiVersion: AKS_API_VERSION },
  )
  const clusters: ClusterResult[] = []

  for (const cl of resp.value ?? []) {
    if (!cl.name) continue
    clusters.push({
      provider: 'azure',
      name: cl.name,
      region: cl.location ?? '',
      status: cl.properties?.provisioningState ?? undefined,
      version: cl.properties?.kubernetesVersion ?? undefined,
      azureResourceGroup: resourceGroupFromId(cl.id),
    })
  }

  return { clusters, errors: [] }
}

type AksCredentialResponse = { kubeconfigs?: { name?: string; value?: string }[] }

/**
 * Produce a working kubeconfig for an AKS cluster. Like TKE, AKS hands back a
 * complete kubeconfig (base64) via listClusterUserCredential — we relay it rather
 * than synthesizing a token-only config. AAD-integrated clusters return an
 * exec-based kubeconfig that needs `kubelogin`; local-account clusters return a
 * self-contained client-certificate config.
 */
export async function generateAksKubeconfig(
  handle: AzureHandle,
  resourceGroup: string,
  clusterName: string,
): Promise<KubeconfigResult | null> {
  const resp = await armRequest<AksCredentialResponse>(
    handle,
    `/subscriptions/${handle.subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.ContainerService/managedClusters/${clusterName}/listClusterUserCredential`,
    { method: 'POST', apiVersion: AKS_API_VERSION },
  )
  const encoded = resp.kubeconfigs?.[0]?.value

  if (!encoded) return null
  const kubeconfig = Buffer.from(encoded, 'base64').toString('utf-8')

  return {
    kubeconfig,
    // The embedded credential outlives the ARM token, but bound the hint to the
    // token lifetime so clients refresh rather than trusting a stale config.
    expiresAt: handle.expiresAt,
  }
}
