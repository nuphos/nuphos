import { AppError } from '@/lib/errors'
import { errorMessage } from '@/lib/observability'

import {
  BOOTSTRAP_REGION,
  REGION_SCAN_CONCURRENCY,
  REGION_SWEEP_DEADLINE_MS,
  mapPool,
  withSweepDeadline,
  volcCall,
  isVolcAuthError,
  withVolcRateLimitRetry,
} from './volcengine'

import type { VolcengineHandle, VolcListError } from './volcengine'

/** ECS's OpenAPI version (query-style actions at open.volcengineapi.com). */
const ECS_VERSION = '2020-04-01'

/** ECS caps DescribeInstances MaxResults at 100. */
const ECS_PAGE_SIZE = 100

export type VolcengineEcsInstance = {
  instanceId: string
  name: string
  instanceType: string
  /** Volcengine status, e.g. RUNNING / STOPPED. */
  state: string
  region: string
  zone: string
  publicIp: string | null
  privateIp: string | null
  cpu: number | null
  /** Memory in GB (ECS reports MiB, converted here). */
  memoryGb: number | null
  osName: string | null
  imageId: string | null
  createdAt: string | null
}

type RawRegion = { RegionId?: string }

/** Discover the account's ECS regions (also used as the VKE sweep list). */
export async function getVolcRegions(handle: VolcengineHandle): Promise<string[]> {
  const result = await volcCall<{ Regions?: RawRegion[] }>(
    handle,
    'ecs',
    BOOTSTRAP_REGION,
    'DescribeRegions',
    ECS_VERSION,
    {},
  )

  return (result?.Regions ?? []).map((r) => r.RegionId).filter((id): id is string => Boolean(id))
}

type RawEcsInstance = {
  InstanceId?: string
  InstanceName?: string
  InstanceTypeId?: string
  Status?: string
  ZoneId?: string
  EipAddress?: { IpAddress?: string }
  NetworkInterfaces?: { PrimaryIpAddress?: string; Type?: string }[]
  Cpus?: number
  MemorySize?: number
  OsName?: string
  ImageId?: string
  CreatedAt?: string
}

function mapInstance(inst: RawEcsInstance, region: string): VolcengineEcsInstance | null {
  if (!inst.InstanceId) return null
  const primaryNic =
    inst.NetworkInterfaces?.find((n) => n.Type === 'primary') ?? inst.NetworkInterfaces?.[0]

  return {
    instanceId: inst.InstanceId,
    name: inst.InstanceName || inst.InstanceId,
    instanceType: inst.InstanceTypeId ?? '',
    state: inst.Status ?? 'Unknown',
    region,
    zone: inst.ZoneId ?? '',
    publicIp: inst.EipAddress?.IpAddress || null,
    privateIp: primaryNic?.PrimaryIpAddress || null,
    cpu: typeof inst.Cpus === 'number' ? inst.Cpus : null,
    // ECS reports memory in MiB.
    memoryGb:
      typeof inst.MemorySize === 'number' ? Math.round((inst.MemorySize / 1024) * 10) / 10 : null,
    osName: inst.OsName ?? null,
    imageId: inst.ImageId ?? null,
    createdAt: inst.CreatedAt ?? null,
  }
}

/**
 * List the team's ECS instances across every available region. Same hardened
 * shape as the Tencent/Aliyun sweeps: rolling region pool, per-region
 * rate-limit retry, partial results + per-region errors, a soft deadline so the
 * desktop's request abort never fires, and a global 403/502 only when NO region
 * answered. Pagination is NextToken-based, so pages within a region are
 * sequential (regions still run concurrently).
 */
export async function listVolcEcsInstances(
  handle: VolcengineHandle,
): Promise<{ instances: VolcengineEcsInstance[]; errors: VolcListError[] }> {
  let regions: string[]

  try {
    regions = await getVolcRegions(handle)
  } catch (e) {
    if (isVolcAuthError(e)) {
      throw new AppError(
        403,
        'volcengine_permission_denied',
        'The Volcengine credentials lack permission to list regions/instances.',
        {
          provider: 'volcengine',
          operation: 'ecs:DescribeRegions',
          upstreamMessage: (e as Error).message,
        },
      )
    }

    return {
      instances: [],
      errors: [{ message: `DescribeRegions failed: ${(e as Error).message}` }],
    }
  }

  const instances: VolcengineEcsInstance[] = []
  const errors: VolcListError[] = []
  const rawErrors: unknown[] = []
  // How many regions returned a clean answer (even if 0 instances). Lets us
  // tell "account is empty" apart from "we couldn't reach anything".
  let reachedRegions = 0

  const sweep = mapPool(regions, REGION_SCAN_CONCURRENCY, async (region) => {
    try {
      let nextToken: string | undefined

      for (;;) {
        const result = await withVolcRateLimitRetry(() =>
          volcCall<{ Instances?: RawEcsInstance[]; NextToken?: string }>(
            handle,
            'ecs',
            region,
            'DescribeInstances',
            ECS_VERSION,
            nextToken
              ? { MaxResults: ECS_PAGE_SIZE, NextToken: nextToken }
              : { MaxResults: ECS_PAGE_SIZE },
          ),
        )

        for (const inst of result?.Instances ?? []) {
          const mapped = mapInstance(inst, region)

          if (mapped) instances.push(mapped)
        }
        nextToken = result?.NextToken || undefined
        if (!nextToken) break
      }
      reachedRegions += 1
    } catch (e) {
      rawErrors.push(e)
      errors.push({ region, message: (e as Error).message })
    }
  })
  // Bound the sweep so the desktop's request abort never fires — return the
  // regions that finished in time rather than nothing.
  const outcome = await withSweepDeadline(sweep, REGION_SWEEP_DEADLINE_MS)

  if (outcome === 'deadline') {
    errors.push({
      message: `ECS region sweep hit its ${String(REGION_SWEEP_DEADLINE_MS / 1000)}s time budget after ${String(reachedRegions)}/${String(regions.length)} regions; showing partial results.`,
    })
  }

  // Only escalate to a global error when NO region answered — a Forbidden from
  // one region must not mask an empty-but-reachable result from another.
  if (instances.length === 0 && reachedRegions === 0) {
    const denied = rawErrors.find(isVolcAuthError)

    if (denied) {
      throw new AppError(
        403,
        'volcengine_permission_denied',
        'The Volcengine credentials do not have permission to DescribeInstances.',
        {
          provider: 'volcengine',
          operation: 'ecs:DescribeInstances',
          upstreamMessage: errorMessage(denied),
        },
      )
    }
    if (errors.length > 0) {
      throw new AppError(
        502,
        'volcengine_ecs_unreachable',
        `Could not reach any Volcengine ECS region endpoint (${String(errors.length)} region(s) failed). First error: ${String(errors[0]?.message)}`,
        { provider: 'volcengine', operation: 'ecs:DescribeInstances' },
      )
    }
  }

  return { instances, errors }
}
