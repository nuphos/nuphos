import * as $OpenApi from '@alicloud/openapi-client'
import SWAS, * as $SWAS from '@alicloud/swas-open20200601'

import { AppError } from '@/lib/errors'
import { errorMessage } from '@/lib/observability'

import {
  REGION_SCAN_CONCURRENCY,
  REGION_SWEEP_DEADLINE_MS,
  PAGE_SCAN_CONCURRENCY,
  SWEEP_CONNECT_TIMEOUT_MS,
  SWEEP_READ_TIMEOUT_MS,
  aliyunBootstrapRegion,
  mapLimit,
  mapPool,
  withSweepDeadline,
  isAliyunAuthError,
  withAliyunRateLimitRetry,
} from './aliyun'

import type { AliyunHandle } from './aliyun'

/** SWAS ListInstances caps PageSize at 100. */
const SWAS_PAGE_SIZE = 100

/**
 * Simple Application Server (轻量应用服务器) — Alibaba's lightweight VPS, the
 * analogue of AWS Lightsail / Tencent Lighthouse. Kept close to the ECS shape so
 * the desktop can render it with the same instance table, plus a couple of
 * SWAS-only fields (bundle plan, subscription expiry).
 */
export type AliyunSwasInstance = {
  instanceId: string
  name: string
  /** Bundle plan type/id (SWAS has no ECS-style instanceType). */
  plan: string
  /** Server running status, e.g. Running / Stopped. */
  status: string
  /** Subscription/business status, e.g. Normal / Expired. */
  businessStatus: string | null
  region: string
  publicIp: string | null
  privateIp: string | null
  cpu: number | null
  memoryGb: number | null
  diskGb: number | null
  osName: string | null
  imageId: string | null
  createdAt: string | null
  /** Subscription expiry (SWAS is prepaid). */
  expiredAt: string | null
}

export type AliyunSwasListError = { region?: string; message: string }

function swasClient(handle: AliyunHandle, region: string): SWAS {
  const config = new $OpenApi.Config({
    accessKeyId: handle.accessKeyId,
    accessKeySecret: handle.accessKeySecret,
    securityToken: handle.securityToken,
  })

  config.endpoint = `swas.${region}.aliyuncs.com`
  config.readTimeout = SWEEP_READ_TIMEOUT_MS
  config.connectTimeout = SWEEP_CONNECT_TIMEOUT_MS

  return new SWAS(config)
}

/**
 * SWAS is offered in a subset of regions, so discover them via SWAS's own
 * ListRegions (bootstrapped from the partition's default region) rather than
 * reusing the ECS region list.
 */
async function getSwasRegions(handle: AliyunHandle): Promise<string[]> {
  const resp = await swasClient(handle, aliyunBootstrapRegion(handle.site)).listRegions(
    new $SWAS.ListRegionsRequest({}),
  )

  return (resp.body?.regions ?? []).map((r) => r.regionId).filter((id): id is string => Boolean(id))
}

type RawSwasInstance = NonNullable<$SWAS.ListInstancesResponseBody['instances']>[number]

function mapInstance(inst: RawSwasInstance, region: string): AliyunSwasInstance | null {
  if (!inst.instanceId) return null
  const spec = inst.resourceSpec

  return {
    instanceId: inst.instanceId,
    name: inst.instanceName || inst.instanceId,
    plan: inst.planType || inst.planId || '',
    status: inst.status ?? 'Unknown',
    businessStatus: inst.businessStatus ?? null,
    region,
    publicIp: inst.publicIpAddress || null,
    privateIp: inst.innerIpAddress || null,
    cpu: typeof spec?.cpu === 'number' ? spec.cpu : null,
    // SWAS resourceSpec.memory is reported in GB (plans are e.g. 1C1G).
    memoryGb: typeof spec?.memory === 'number' ? spec.memory : null,
    diskGb: typeof spec?.diskSize === 'number' ? spec.diskSize : null,
    osName: inst.image?.osType ?? inst.image?.imageName ?? null,
    imageId: inst.imageId ?? null,
    createdAt: inst.creationTime ?? null,
    expiredAt: inst.expiredTime ?? null,
  }
}

/**
 * List the team's Simple Application Server instances across every SWAS region.
 * Mirrors `listEcsInstances`: bounded-concurrency region sweep with per-region
 * rate-limit retry and partial-result tolerance — a 403 when access is denied
 * everywhere, and a hard failure only when no region can be reached at all.
 */
export async function listSwasInstances(
  handle: AliyunHandle,
): Promise<{ instances: AliyunSwasInstance[]; errors: AliyunSwasListError[] }> {
  let regions: string[]

  try {
    regions = await getSwasRegions(handle)
  } catch (e) {
    if (isAliyunAuthError(e)) {
      throw new AppError(
        403,
        'aliyun_permission_denied',
        'The Alibaba Cloud credentials lack permission to list Simple Application Server regions/instances.',
        {
          provider: 'aliyun',
          operation: 'swas:ListRegions',
          upstreamMessage: (e as Error).message,
        },
      )
    }

    return { instances: [], errors: [{ message: `ListRegions failed: ${(e as Error).message}` }] }
  }

  const instances: AliyunSwasInstance[] = []
  const errors: AliyunSwasListError[] = []
  const rawErrors: unknown[] = []
  // How many regions returned a clean answer (even if 0 instances). Lets us tell
  // "account is empty" apart from "we couldn't reach anything".
  let reachedRegions = 0

  const collect = (batch: RawSwasInstance[] | undefined, region: string) => {
    for (const inst of batch ?? []) {
      const mapped = mapInstance(inst, region)

      if (mapped) instances.push(mapped)
    }
  }

  const sweep = mapPool(regions, REGION_SCAN_CONCURRENCY, async (region) => {
    try {
      const client = swasClient(handle, region)
      const listPage = (pageNumber: number) =>
        withAliyunRateLimitRetry(() =>
          client.listInstances(
            // RegionId is a mandatory request parameter (endpoint alone isn't enough).
            new $SWAS.ListInstancesRequest({
              regionId: region,
              pageSize: SWAS_PAGE_SIZE,
              pageNumber,
            }),
          ),
        )
      // Page 1 gives the total; fan the remaining pages out concurrently so a
      // region with hundreds of instances isn't paged one-at-a-time.
      const first = await listPage(1)

      collect(first.body?.instances, region)
      const total = first.body?.totalCount ?? first.body?.instances?.length ?? 0
      const pageCount = Math.ceil(total / SWAS_PAGE_SIZE)

      if (pageCount > 1) {
        const rest = Array.from({ length: pageCount - 1 }, (_, i) => i + 2)

        await mapLimit(rest, PAGE_SCAN_CONCURRENCY, async (pageNumber) => {
          const resp = await listPage(pageNumber)

          collect(resp.body?.instances, region)
        })
      }
      reachedRegions += 1
    } catch (e) {
      rawErrors.push(e)
      errors.push({ region, message: (e as Error).message })
    }
  })
  // Bound the sweep so the desktop's 15s request abort never fires — return the
  // regions that finished in time rather than nothing.
  const outcome = await withSweepDeadline(sweep, REGION_SWEEP_DEADLINE_MS)

  if (outcome === 'deadline') {
    errors.push({
      message: `SWAS region sweep hit its ${String(REGION_SWEEP_DEADLINE_MS / 1000)}s time budget after ${String(reachedRegions)}/${String(regions.length)} regions; showing partial results.`,
    })
  }

  // Only escalate to a global error when NO region answered. If even one region
  // listed successfully (empty), the empty result is real — a Forbidden/other
  // error from a different region must not mask it as an account-wide 403/502.
  if (instances.length === 0 && reachedRegions === 0) {
    const denied = rawErrors.find(isAliyunAuthError)

    if (denied) {
      throw new AppError(
        403,
        'aliyun_permission_denied',
        'The Alibaba Cloud credentials do not have permission to ListInstances (Simple Application Server).',
        {
          provider: 'aliyun',
          operation: 'swas:ListInstances',
          upstreamMessage: errorMessage(denied),
        },
      )
    }
    // No region responded at all → don't claim the account is empty.
    if (errors.length > 0) {
      throw new AppError(
        502,
        'aliyun_swas_unreachable',
        `Could not reach any Alibaba Cloud SWAS region endpoint (${String(errors.length)} region(s) failed). First error: ${String(errors[0]?.message)}`,
        { provider: 'aliyun', operation: 'swas:ListInstances' },
      )
    }
  }

  return { instances, errors }
}
