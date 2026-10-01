import CS, * as $CS from '@alicloud/cs20151215'
import * as $OpenApi from '@alicloud/openapi-client'

import { AppError } from '@/lib/errors'

import {
  aliyunErrorCode,
  isAliyunAckNotInitialized,
  isAliyunAuthError,
  withAliyunRateLimitRetry,
} from './aliyun-errors'

import type { AliyunHandle } from './aliyun-sts'
import type { KubeconfigResult } from './kubeconfig'
import type { AliyunSite, ClusterResult } from './types'

export type { AliyunSite }
export {
  aliyunErrorCode,
  isAliyunAckNotInitialized,
  isAliyunAuthError,
  isAliyunInvalidCredential,
  isAliyunRateLimit,
  withAliyunRateLimitRetry,
} from './aliyun-errors'
export {
  aliyunBootstrapRegion,
  aliyunOidcConfigured,
  aliyunOidcInfo,
  assumeRoleWithOidc,
  verifyAliyunRole,
} from './aliyun-sts'
export type { AliyunHandle } from './aliyun-sts'
export {
  mapLimit,
  mapPool,
  PAGE_SCAN_CONCURRENCY,
  REGION_SCAN_CONCURRENCY,
  REGION_SWEEP_DEADLINE_MS,
  SWEEP_CONNECT_TIMEOUT_MS,
  SWEEP_READ_TIMEOUT_MS,
  withSweepDeadline,
} from './aliyun-sweep'

export type AckListError = { region?: string; message: string }

/**
 * Account-global center endpoint for ACK's DescribeClustersV1. The China center
 * is `cs.aliyuncs.com`; International accounts must go through a regional
 * endpoint in their partition (DescribeClustersV1 still returns all clusters).
 */
function ackCenterEndpoint(site: AliyunSite): string {
  return site === 'international' ? 'cs.ap-southeast-1.aliyuncs.com' : 'cs.aliyuncs.com'
}

/**
 * ACK client. Cluster management (list/kubeconfig) is served from the
 * partition's center endpoint; a regional endpoint (`cs.<region>.aliyuncs.com`)
 * is used when we already know the cluster's region.
 */
function ackClient(handle: AliyunHandle, region?: string): CS {
  const config = new $OpenApi.Config({
    accessKeyId: handle.accessKeyId,
    accessKeySecret: handle.accessKeySecret,
    securityToken: handle.securityToken,
  })

  config.endpoint = region ? `cs.${region}.aliyuncs.com` : ackCenterEndpoint(handle.site)
  config.readTimeout = 30000
  config.connectTimeout = 15000

  return new CS(config)
}

/**
 * List the team's ACK clusters. Unlike Tencent's per-region sweep, ACK's
 * DescribeClustersV1 is account-global: one paginated call returns clusters
 * across every region.
 */
export async function listAckClusters(
  handle: AliyunHandle,
): Promise<{ clusters: ClusterResult[]; errors: AckListError[] }> {
  const clusters: ClusterResult[] = []
  const client = ackClient(handle)
  const pageSize = 50
  let pageNumber = 1

  try {
    for (;;) {
      const resp = await withAliyunRateLimitRetry(() =>
        client.describeClustersV1(new $CS.DescribeClustersV1Request({ pageSize, pageNumber })),
      )
      const batch = resp.body?.clusters ?? []

      for (const cl of batch) {
        if (!cl.clusterId) continue
        clusters.push({
          provider: 'aliyun',
          name: cl.name || cl.clusterId,
          region: cl.regionId ?? '',
          status: cl.state ?? undefined,
          version: cl.currentVersion ?? undefined,
          createdAt: cl.created ? new Date(cl.created) : undefined,
          aliyunClusterId: cl.clusterId,
        })
      }
      const total = resp.body?.pageInfo?.totalCount ?? clusters.length

      if (batch.length < pageSize || clusters.length >= total) break
      pageNumber += 1
    }
  } catch (e) {
    // ACK never initialized in this account → no clusters (clean empty), not an
    // error. Distinguish from a real permission denial below.
    if (isAliyunAckNotInitialized(e)) {
      return { clusters, errors: [] }
    }
    if (isAliyunAuthError(e)) {
      throw new AppError(
        403,
        'aliyun_permission_denied',
        'The Alibaba Cloud credentials do not have permission to list ACK clusters.',
        {
          provider: 'aliyun',
          operation: 'cs:DescribeClustersV1',
          upstreamMessage: (e as Error).message,
        },
      )
    }

    return { clusters, errors: [{ message: `DescribeClustersV1 failed: ${(e as Error).message}` }] }
  }

  return { clusters, errors: [] }
}

/**
 * Produce a working kubeconfig for an ACK cluster.
 *
 * DescribeClusterUserKubeconfig returns a complete, ready kubeconfig (like TKE's
 * DescribeClusterKubeconfig). We request the PUBLIC endpoint (PrivateIpAddress
 * = false); if the cluster has no public API server endpoint enabled, Aliyun
 * returns an empty config or an error — surfaced as an actionable 409, never
 * enabling it from this read path.
 */
export async function generateAckKubeconfig(
  handle: AliyunHandle,
  region: string,
  clusterId: string,
): Promise<KubeconfigResult | null> {
  const client = ackClient(handle, region || undefined)
  let resp: $CS.DescribeClusterUserKubeconfigResponse

  try {
    resp = await withAliyunRateLimitRetry(() =>
      client.describeClusterUserKubeconfig(
        clusterId,
        new $CS.DescribeClusterUserKubeconfigRequest({ privateIpAddress: false }),
      ),
    )
  } catch (e) {
    if (/NotFound/i.test(aliyunErrorCode(e))) return null
    if (/Endpoint|PublicNetwork|ApiServer/i.test((e as Error).message ?? '')) {
      throw new AppError(
        409,
        'aliyun_endpoint_not_enabled',
        "The ACK cluster's public API server endpoint is not enabled. Enable public access in the Alibaba Cloud console, then retry.",
        { provider: 'aliyun', clusterId },
      )
    }
    throw e
  }
  const kubeconfig = resp.body?.config

  if (!kubeconfig) {
    throw new AppError(
      409,
      'aliyun_endpoint_not_enabled',
      'The ACK cluster returned no public kubeconfig — its public API server endpoint is likely not enabled. Enable public access in the Alibaba Cloud console, then retry.',
      { provider: 'aliyun', clusterId },
    )
  }

  return {
    kubeconfig,
    expiresAt: new Date(Date.now() + 14 * 60 * 1000),
  }
}
