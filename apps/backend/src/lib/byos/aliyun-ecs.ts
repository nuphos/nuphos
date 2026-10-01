import ECS, * as $ECS from '@alicloud/ecs20140526'
import * as $OpenApi from '@alicloud/openapi-client'

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
  aliyunErrorCode,
  isAliyunAuthError,
  withAliyunRateLimitRetry,
} from './aliyun'

import type { AliyunHandle } from './aliyun'

/** ECS caps DescribeInstances PageSize at 100. */
const ECS_PAGE_SIZE = 100

export type AliyunEcsInstance = {
  instanceId: string
  name: string
  instanceType: string
  /** Aliyun state, e.g. Running / Stopped / Starting. */
  state: string
  region: string
  zone: string
  publicIp: string | null
  privateIp: string | null
  cpu: number | null
  /** Memory in GB (ECS reports MB, converted here). */
  memoryGb: number | null
  osName: string | null
  imageId: string | null
  createdAt: string | null
}

export type AliyunEcsListError = { region?: string; message: string }

function ecsClient(handle: AliyunHandle, region: string): ECS {
  const config = new $OpenApi.Config({
    accessKeyId: handle.accessKeyId,
    accessKeySecret: handle.accessKeySecret,
    securityToken: handle.securityToken,
  })

  config.endpoint = `ecs.${region}.aliyuncs.com`
  config.readTimeout = SWEEP_READ_TIMEOUT_MS
  config.connectTimeout = SWEEP_CONNECT_TIMEOUT_MS

  return new ECS(config)
}

async function getEcsRegions(handle: AliyunHandle): Promise<string[]> {
  const resp = await ecsClient(handle, aliyunBootstrapRegion(handle.site)).describeRegions(
    new $ECS.DescribeRegionsRequest({}),
  )

  return (resp.body?.regions?.region ?? [])
    .map((r) => r.regionId)
    .filter((id): id is string => Boolean(id))
}

type RawEcsInstance = NonNullable<
  NonNullable<$ECS.DescribeInstancesResponseBody['instances']>['instance']
>[number]

function mapInstance(inst: RawEcsInstance, region: string): AliyunEcsInstance | null {
  if (!inst.instanceId) return null
  const publicIp = inst.publicIpAddress?.ipAddress?.[0] ?? inst.eipAddress?.ipAddress ?? null
  const privateIp =
    inst.vpcAttributes?.privateIpAddress?.ipAddress?.[0] ??
    inst.innerIpAddress?.ipAddress?.[0] ??
    null

  return {
    instanceId: inst.instanceId,
    name: inst.instanceName || inst.instanceId,
    instanceType: inst.instanceType ?? '',
    state: inst.status ?? 'Unknown',
    region,
    zone: inst.zoneId ?? '',
    publicIp,
    privateIp,
    cpu: typeof inst.cpu === 'number' ? inst.cpu : null,
    // ECS reports memory in MB.
    memoryGb: typeof inst.memory === 'number' ? Math.round((inst.memory / 1024) * 10) / 10 : null,
    osName: inst.oSName ?? inst.oSNameEn ?? null,
    imageId: inst.imageId ?? null,
    createdAt: inst.creationTime ?? null,
  }
}

/**
 * List the team's ECS instances across every available region. Mirrors
 * `listCvmInstances` / `listEc2Instances`: bounded-concurrency region sweep,
 * per-region rate-limit retry, partial results + per-region errors, but throws
 * a 403 when access is denied everywhere so the UI can point at the RAM policy.
 */
export async function listEcsInstances(
  handle: AliyunHandle,
): Promise<{ instances: AliyunEcsInstance[]; errors: AliyunEcsListError[] }> {
  let regions: string[]

  try {
    regions = await getEcsRegions(handle)
  } catch (e) {
    if (isAliyunAuthError(e)) {
      throw new AppError(
        403,
        'aliyun_permission_denied',
        'The Alibaba Cloud credentials lack permission to list regions/instances.',
        {
          provider: 'aliyun',
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

  const instances: AliyunEcsInstance[] = []
  const errors: AliyunEcsListError[] = []
  const rawErrors: unknown[] = []
  // How many regions returned a clean answer (even if 0 instances). Lets us tell
  // "account is empty" apart from "we couldn't reach anything".
  let reachedRegions = 0

  const collect = (batch: RawEcsInstance[] | undefined, region: string) => {
    for (const inst of batch ?? []) {
      const mapped = mapInstance(inst, region)

      if (mapped) instances.push(mapped)
    }
  }

  const sweep = mapPool(regions, REGION_SCAN_CONCURRENCY, async (region) => {
    try {
      const client = ecsClient(handle, region)
      const listPage = (pageNumber: number) =>
        withAliyunRateLimitRetry(() =>
          client.describeInstances(
            // RegionId is a MANDATORY request parameter for DescribeInstances —
            // the regional endpoint alone isn't enough.
            new $ECS.DescribeInstancesRequest({
              regionId: region,
              pageSize: ECS_PAGE_SIZE,
              pageNumber,
            }),
          ),
        )
      // Page 1 gives the total; fan the remaining pages out concurrently so a
      // region with hundreds of instances isn't paged one-at-a-time.
      const first = await listPage(1)

      collect(first.body?.instances?.instance, region)
      const total = first.body?.totalCount ?? first.body?.instances?.instance?.length ?? 0
      const pageCount = Math.ceil(total / ECS_PAGE_SIZE)

      if (pageCount > 1) {
        const rest = Array.from({ length: pageCount - 1 }, (_, i) => i + 2)

        await mapLimit(rest, PAGE_SCAN_CONCURRENCY, async (pageNumber) => {
          const resp = await listPage(pageNumber)

          collect(resp.body?.instances?.instance, region)
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
      message: `ECS region sweep hit its ${String(REGION_SWEEP_DEADLINE_MS / 1000)}s time budget after ${String(reachedRegions)}/${String(regions.length)} regions; showing partial results.`,
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
        'The Alibaba Cloud credentials do not have permission to DescribeInstances.',
        {
          provider: 'aliyun',
          operation: 'ecs:DescribeInstances',
          upstreamMessage: errorMessage(denied),
        },
      )
    }
    // No region responded at all (every endpoint errored — e.g. a proxy
    // hijacking *.aliyuncs.com DNS). Don't claim the account is empty; surface a
    // clear failure.
    if (errors.length > 0) {
      throw new AppError(
        502,
        'aliyun_ecs_unreachable',
        `Could not reach any Alibaba Cloud ECS region endpoint (${String(errors.length)} region(s) failed). First error: ${String(errors[0]?.message)}`,
        { provider: 'aliyun', operation: 'ecs:DescribeInstances' },
      )
    }
  }

  return { instances, errors }
}

export { aliyunErrorCode }
