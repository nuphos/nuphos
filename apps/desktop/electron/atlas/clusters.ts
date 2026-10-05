import { apiUrl } from '../api-endpoint.ts'

import { appendQuery, call, fetchWithRetry, readToken, unwrapFetchError } from './client'

export type Cluster = {
  provider: 'aws' | 'gcp'
  name: string
  region: string
  endpoint?: string
  status?: string
  version?: string
  createdAt?: string
  awsRoleArn?: string
  awsClusterArn?: string
  gcpServiceAccountEmail?: string
  gcpProjectId?: string
  gcpResourceName?: string
}

export type ClustersResponse = {
  clusters: Cluster[]
  errors: { provider: string; bindingId: string; region?: string; message: string }[]
}

export type KubeconfigResponse = {
  yaml: string
  expiresAt: string | null
}

/** Marks a human-only permission-admin binding (never handed to the agent).
 *  null/undefined = a normal operational binding. */
export type BindingPurpose = 'permission-admin' | null

export async function listClusters(teamId: string): Promise<ClustersResponse> {
  return call<ClustersResponse>('GET', `/teams/${teamId}/clusters`)
}

export async function listTencentClusters(
  teamId: string,
  accountId: string,
): Promise<ClustersResponse['clusters']> {
  // TKE listing sweeps every region the account can see, three at a time, with
  // a rate-limit retry per region — routinely ~10s and well past the default
  // deadline on a cold backend. Same headroom as the VKE sweep below.
  const data = await call<ClustersResponse>(
    'GET',
    `/teams/${teamId}/tencent-accounts/${accountId}/clusters`,
    undefined,
    { timeoutMs: 30_000 },
  )
  const clusters = data.clusters ?? []
  const errors = data.errors ?? []

  // A 200 with no clusters BUT errors (e.g. a transient TKE rate-limit on the
  // region scan) is a partial failure, not a confirmed-empty account. Throw so
  // the UI keeps cached rows / stays in loading instead of flashing "No items".
  if (clusters.length === 0 && errors.length > 0) {
    throw new Error(errors[0]?.message || 'Failed to list TKE clusters')
  }
  // Partial success: some regions returned clusters, others errored (the empty
  // regions are retried server-side, so this is usually noise). Don't drop the
  // signal on the floor — log it for diagnosis rather than collapsing silently.
  if (errors.length > 0) {
    console.warn(
      `[tencent] cluster scan returned ${String(clusters.length)} clusters with ${String(errors.length)} region error(s):`,
      errors.map((e) => `${e.region ?? '?'}: ${e.message}`).join('; '),
    )
  }

  return clusters
}

export async function listAzureClusters(
  teamId: string,
  accountId: string,
): Promise<ClustersResponse['clusters']> {
  const data = await call<ClustersResponse>(
    'GET',
    `/teams/${teamId}/azure-accounts/${accountId}/clusters`,
  )
  const clusters = data.clusters ?? []
  const errors = data.errors ?? []

  // A 200 with no clusters BUT errors is a partial failure, not a
  // confirmed-empty subscription — throw so the UI keeps cached rows / stays in
  // loading instead of flashing "No items".
  if (clusters.length === 0 && errors.length > 0) {
    throw new Error(errors[0]?.message || 'Failed to list AKS clusters')
  }

  return clusters
}

export async function fetchKubeconfig(route: string): Promise<KubeconfigResponse> {
  const token = await readToken()

  if (!token) throw new Error('Not signed in')
  let res: Response

  try {
    res = await fetchWithRetry(`${apiUrl()}${route}`, {
      headers: { authorization: `Bearer ${token}` },
    })
  } catch (e) {
    throw unwrapFetchError(e, route)
  }
  if (!res.ok) {
    let message = `HTTP ${String(res.status)}`

    try {
      const j = (await res.json()) as { error?: { message?: string } }

      if (j.error?.message) message = j.error.message
    } catch {
      // ignore
    }
    throw new Error(message)
  }

  return {
    yaml: await res.text(),
    expiresAt: res.headers.get('x-kubeconfig-expires-at'),
  }
}

export async function getKubeconfig(
  teamId: string,
  provider: string,
  region: string,
  name: string,
): Promise<KubeconfigResponse> {
  return fetchKubeconfig(`/teams/${teamId}/clusters/${provider}/${region}/${name}/kubeconfig`)
}

export async function getAwsClusterKubeconfig(
  teamId: string,
  accountId: string,
  clusterName: string,
  region?: string,
  roleId?: string,
): Promise<KubeconfigResponse> {
  const q = appendQuery('', { region, roleId })

  return fetchKubeconfig(
    `/teams/${teamId}/aws-accounts/${accountId}/clusters/${clusterName}/kubeconfig${q}`,
  )
}

export async function getTencentClusterKubeconfig(
  teamId: string,
  accountId: string,
  clusterId: string,
  region?: string,
): Promise<KubeconfigResponse> {
  const q = appendQuery('', { region })

  return fetchKubeconfig(
    `/teams/${teamId}/tencent-accounts/${accountId}/clusters/${clusterId}/kubeconfig${q}`,
  )
}

export async function getAzureClusterKubeconfig(
  teamId: string,
  accountId: string,
  clusterName: string,
  resourceGroup?: string,
): Promise<KubeconfigResponse> {
  const q = appendQuery('', { resourceGroup })

  return fetchKubeconfig(
    `/teams/${teamId}/azure-accounts/${accountId}/clusters/${clusterName}/kubeconfig${q}`,
  )
}

export async function getVolcengineClusterKubeconfig(
  teamId: string,
  accountId: string,
  clusterId: string,
  region?: string,
  // Issue a NEW credential instead of reusing — VKE grants only apply to
  // kubeconfigs issued after the grant (RBAC re-check path).
  fresh?: boolean,
): Promise<KubeconfigResponse> {
  const q = appendQuery('', { region, fresh: fresh ? '1' : undefined })

  return fetchKubeconfig(
    `/teams/${teamId}/volcengine-accounts/${accountId}/clusters/${clusterId}/kubeconfig${q}`,
  )
}

export async function getAliyunClusterKubeconfig(
  teamId: string,
  accountId: string,
  clusterId: string,
  region?: string,
): Promise<KubeconfigResponse> {
  const q = appendQuery('', { region })

  return fetchKubeconfig(
    `/teams/${teamId}/aliyun-accounts/${accountId}/clusters/${clusterId}/kubeconfig${q}`,
  )
}
