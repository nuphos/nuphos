import { tke } from 'tencentcloud-sdk-nodejs-tke'

import { AppError } from '@/lib/errors'
import { errorMessage } from '@/lib/observability'

import {
  isTencentAuthError,
  mapLimit,
  REGION_SCAN_CONCURRENCY,
  tencentBootstrapRegion,
  tencentEndpoint,
  tencentErrorCode,
  withTencentRateLimitRetry,
} from './tencent-core'

import type { KubeconfigResult } from './kubeconfig'
import type { TencentHandle, TkeListError } from './tencent-core'
import type { ClusterResult, TencentSite } from './types'

export type { TencentSite }
export type { TencentHandle, TkeListError } from './tencent-core'
export {
  isTencentAuthError,
  isTencentRateLimit,
  mapLimit,
  REGION_SCAN_CONCURRENCY,
  tencentBootstrapRegion,
  tencentEndpoint,
  tencentErrorCode,
  withTencentRateLimitRetry,
} from './tencent-core'
export {
  assumeRoleWithWebIdentity,
  tencentOidcConfigured,
  tencentOidcInfo,
  verifyTencentRole,
} from './tencent-sts'

const TkeClient = tke.v20180525.Client

function tkeClient(region: string, handle: TencentHandle) {
  return new TkeClient({
    credential: { secretId: handle.secretId, secretKey: handle.secretKey, token: handle.token },
    region,
    profile: { httpProfile: { reqTimeout: 30, endpoint: tencentEndpoint('tke', handle.site) } },
  })
}

async function getAvailableRegions(handle: TencentHandle): Promise<string[]> {
  const resp = await tkeClient(tencentBootstrapRegion(handle.site), handle).DescribeRegions()

  // DescribeRegions already scopes to TKE-supported regions, so scan them all
  // (an empty region just returns 0 clusters). Only skip a region it explicitly
  // marks unavailable — never filter on a positive status string we can't be
  // sure of, or we'd silently skip the user's region.
  return (resp.RegionInstanceSet ?? [])
    .filter((r) => !/unavailable|unable|disabled|maintenance/i.test(r.Status ?? ''))
    .map((r) => r.RegionName)
    .filter((name): name is string => Boolean(name))
}

/**
 * List the team's TKE clusters across every available region. Mirrors
 * `listEksClusters`: partial results + per-region errors, but throws a 403
 * when access is denied everywhere so the UI can point at the CAM policy.
 */
export async function listTkeClusters(
  handle: TencentHandle,
): Promise<{ clusters: ClusterResult[]; errors: TkeListError[] }> {
  let regions: string[]

  try {
    regions = await getAvailableRegions(handle)
  } catch (e) {
    if (isTencentAuthError(e)) {
      throw new AppError(
        403,
        'tencent_permission_denied',
        'The Tencent credentials lack permission to list regions/clusters.',
        {
          provider: 'tencent',
          operation: 'tke:DescribeRegions',
          upstreamMessage: (e as Error).message,
        },
      )
    }

    return {
      clusters: [],
      errors: [{ message: `DescribeRegions failed: ${(e as Error).message}` }],
    }
  }

  const clusters: ClusterResult[] = []
  const errors: TkeListError[] = []
  const rawErrors: unknown[] = []

  // Bounded concurrency keeps us under TKE's per-second request limit (≈20/s);
  // the retry recovers any region that still trips it — so the cluster's own
  // region is never silently dropped to a transient RequestLimitExceeded.
  await mapLimit(regions, REGION_SCAN_CONCURRENCY, async (region) => {
    try {
      const resp = await withTencentRateLimitRetry(() =>
        tkeClient(region, handle).DescribeClusters({}),
      )

      for (const cl of resp.Clusters ?? []) {
        if (!cl.ClusterId) continue
        clusters.push({
          provider: 'tencent',
          name: cl.ClusterName || cl.ClusterId,
          region,
          status: cl.ClusterStatus ?? undefined,
          version: cl.ClusterVersion ?? undefined,
          createdAt: cl.CreatedTime ? new Date(cl.CreatedTime) : undefined,
          tencentClusterId: cl.ClusterId,
        })
      }
    } catch (e) {
      // DescribeRegions lists some regions where TKE/DescribeClusters isn't
      // actually offered — skip those silently rather than surfacing noise.
      if (/UnsupportedRegion/i.test(tencentErrorCode(e))) return
      rawErrors.push(e)
      errors.push({ region, message: (e as Error).message })
    }
  })

  if (clusters.length === 0) {
    const denied = rawErrors.find(isTencentAuthError)

    if (denied) {
      throw new AppError(
        403,
        'tencent_permission_denied',
        'The Tencent credentials do not have permission to DescribeClusters.',
        {
          provider: 'tencent',
          operation: 'tke:DescribeClusters',
          upstreamMessage: errorMessage(denied),
        },
      )
    }
  }

  return { clusters, errors }
}

/**
 * Require the cluster's public (extranet) API endpoint to already be enabled.
 * We deliberately do NOT enable it here: turning on a public Kubernetes API
 * endpoint is a network/security change and must never be a side effect of a
 * read-only kubeconfig fetch. If it's off, surface an actionable error so the
 * owner can enable it explicitly in the Tencent console.
 */
async function requireExtranetEndpoint(
  client: InstanceType<typeof TkeClient>,
  clusterId: string,
): Promise<void> {
  const status = await withTencentRateLimitRetry(() =>
    client.DescribeClusterEndpointStatus({ ClusterId: clusterId, IsExtranet: true }),
  )

  if (status.Status === 'Created') return
  throw new AppError(
    409,
    'tencent_endpoint_not_enabled',
    `The TKE cluster's public API endpoint is not enabled (status: ${status.Status ?? 'unknown'}). Enable the cluster's extranet endpoint in the Tencent console, then retry.`,
    { provider: 'tencent', clusterId, endpointStatus: status.Status ?? null },
  )
}

/**
 * Produce a working kubeconfig for a TKE cluster.
 *
 * Unlike EKS/GKE (where a cloud-IAM token IS a valid k8s bearer token), TKE's
 * API server uses its own credentials and hands back a complete kubeconfig via
 * DescribeClusterKubeconfig (DescribeClusterSecurity only offers basic-auth,
 * which the token-only `renderKubeconfig` can't represent). We require the
 * public endpoint to already be enabled (never enable it from this read path)
 * then relay TKE's own kubeconfig.
 */
export async function generateTkeKubeconfig(
  handle: TencentHandle,
  region: string,
  clusterId: string,
): Promise<KubeconfigResult | null> {
  const client = tkeClient(region, handle)

  const list = await withTencentRateLimitRetry(() =>
    client.DescribeClusters({ ClusterIds: [clusterId] }),
  )

  if (!(list.Clusters ?? []).some((cl) => cl.ClusterId === clusterId)) return null

  await requireExtranetEndpoint(client, clusterId)

  const resp = await withTencentRateLimitRetry(() =>
    client.DescribeClusterKubeconfig({ ClusterId: clusterId, IsExtranet: true }),
  )

  if (!resp.Kubeconfig) throw new Error('TKE returned an empty kubeconfig')

  return {
    kubeconfig: resp.Kubeconfig,
    expiresAt: new Date(Date.now() + 14 * 60 * 1000),
  }
}
