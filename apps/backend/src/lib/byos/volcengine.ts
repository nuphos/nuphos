import { AppError } from '@/lib/errors'

// Generic sweep helpers (bounded pools, deadlines, timeouts) live in aliyun.ts
// but are provider-agnostic; reuse them rather than duplicating.
import {
  REGION_SCAN_CONCURRENCY,
  REGION_SWEEP_DEADLINE_MS,
  SWEEP_READ_TIMEOUT_MS,
  mapPool,
  withSweepDeadline,
} from './aliyun'
import {
  isVolcAuthError,
  isVolcRegionUnsupported,
  VKE_VERSION,
  volcCall,
  withVolcRateLimitRetry,
} from './volcengine-api'

import type { ClusterResult } from './types'
import type { VolcengineHandle } from './volcengine-api'

export {
  REGION_SCAN_CONCURRENCY,
  REGION_SWEEP_DEADLINE_MS,
  SWEEP_READ_TIMEOUT_MS,
  mapPool,
  withSweepDeadline,
}

export {
  isVolcAuthError,
  isVolcInvalidCredential,
  isVolcRateLimit,
  isVolcRegionUnsupported,
  volcCall,
  volcErrorCode,
  withVolcRateLimitRetry,
} from './volcengine-api'
export type { VolcengineHandle } from './volcengine-api'
export { generateVkeKubeconfig } from './volcengine-kubeconfig'
export {
  assumeRoleWithOidc,
  verifyVolcengineRole,
  volcengineOidcConfigured,
  volcengineOidcInfo,
} from './volcengine-sts'

/**
 * Region used to bootstrap region discovery (DescribeRegions) and as the
 * sandbox CLI default. Volcengine is mainland-China only (its international arm
 * is the separate BytePlus brand, out of scope), so cn-beijing is always valid.
 */
export const BOOTSTRAP_REGION = 'cn-beijing'

export type VolcListError = { region?: string; message: string }

type RawVkeCluster = {
  Id?: string
  Name?: string
  KubernetesVersion?: string
  Status?: { Phase?: string }
  CreateTime?: string
}

const VKE_PAGE_SIZE = 100

/**
 * List the team's VKE clusters. ListClusters is region-scoped, so sweep the ECS
 * region list with the usual tolerance: regions where VKE isn't offered (or is
 * unreachable) land in errors[]; a global failure is raised only when no region
 * answered at all.
 */
export async function listVkeClusters(
  handle: VolcengineHandle,
  regions: string[],
): Promise<{ clusters: ClusterResult[]; errors: VolcListError[] }> {
  const clusters: ClusterResult[] = []
  const errors: VolcListError[] = []
  const rawErrors: unknown[] = []
  // Regions that gave a clean answer (even 0 clusters) or told us VKE isn't
  // offered there — both are definitive, not failures.
  let reachedRegions = 0

  const sweep = mapPool(regions, REGION_SCAN_CONCURRENCY, async (region) => {
    try {
      let pageNumber = 1

      for (;;) {
        const result = await withVolcRateLimitRetry(() =>
          volcCall<{ Items?: RawVkeCluster[]; TotalCount?: number }>(
            handle,
            'vke',
            region,
            'ListClusters',
            VKE_VERSION,
            { PageNumber: pageNumber, PageSize: VKE_PAGE_SIZE },
            { json: true },
          ),
        )
        const batch = result?.Items ?? []

        for (const cl of batch) {
          if (!cl.Id) continue
          clusters.push({
            provider: 'volcengine',
            name: cl.Name || cl.Id,
            region,
            status: cl.Status?.Phase ?? undefined,
            version: cl.KubernetesVersion ?? undefined,
            createdAt: cl.CreateTime ? new Date(cl.CreateTime) : undefined,
            volcengineClusterId: cl.Id,
          })
        }
        const total = result?.TotalCount ?? batch.length

        if (batch.length < VKE_PAGE_SIZE || pageNumber * VKE_PAGE_SIZE >= total) break
        pageNumber += 1
      }
      reachedRegions += 1
    } catch (e) {
      // The sweep covers the account's ECS regions; VKE isn't offered in all of
      // them and the gateway answers with an endpoint-mismatch error. That's a
      // definitive "no VKE here", not a failure — skip without recording.
      if (isVolcRegionUnsupported(e)) {
        reachedRegions += 1

        return
      }
      rawErrors.push(e)
      errors.push({ region, message: (e as Error).message })
    }
  })
  const outcome = await withSweepDeadline(sweep, REGION_SWEEP_DEADLINE_MS)

  if (outcome === 'deadline') {
    errors.push({
      message: `VKE region sweep hit its ${String(REGION_SWEEP_DEADLINE_MS / 1000)}s time budget after ${String(reachedRegions)}/${String(regions.length)} regions; showing partial results.`,
    })
  }

  // Only escalate to a global error when NO region answered — a failure in one
  // region must not mask an empty-but-reachable result from another.
  if (clusters.length === 0 && reachedRegions === 0) {
    const denied = rawErrors.find(isVolcAuthError)

    if (denied) {
      throw new AppError(
        403,
        'volcengine_permission_denied',
        'The Volcengine credentials do not have permission to list VKE clusters.',
        {
          provider: 'volcengine',
          operation: 'vke:ListClusters',
          upstreamMessage: (denied as Error).message,
        },
      )
    }
    if (errors.length > 0) {
      throw new AppError(
        502,
        'volcengine_vke_unreachable',
        `Could not reach any Volcengine VKE region endpoint (${String(errors.length)} region(s) failed). First error: ${String(errors[0]?.message)}`,
        { provider: 'volcengine', operation: 'vke:ListClusters' },
      )
    }
  }

  return { clusters, errors }
}
