import { cvm } from 'tencentcloud-sdk-nodejs-cvm'

import { AppError } from '@/lib/errors'
import { errorMessage } from '@/lib/observability'

import {
  tencentBootstrapRegion,
  tencentEndpoint,
  REGION_SCAN_CONCURRENCY,
  mapLimit,
  withTencentRateLimitRetry,
  tencentErrorCode,
  isTencentAuthError,
} from './tencent'

import type { TencentHandle } from './tencent'

const CvmClient = cvm.v20170312.Client

/** Page size for DescribeInstances (CVM caps Limit at 100). */
const CVM_PAGE_LIMIT = 100

export type TencentCvmInstance = {
  instanceId: string
  name: string
  instanceType: string
  /** Tencent state string, e.g. RUNNING / STOPPED / PENDING. */
  state: string
  region: string
  zone: string
  publicIp: string | null
  privateIp: string | null
  cpu: number | null
  /** Memory in GB (CVM reports GB directly). */
  memoryGb: number | null
  osName: string | null
  imageId: string | null
  createdAt: string | null
}

export type TencentCvmListError = { region?: string; message: string }

function cvmClient(region: string, handle: TencentHandle) {
  return new CvmClient({
    credential: { secretId: handle.secretId, secretKey: handle.secretKey, token: handle.token },
    region,
    profile: { httpProfile: { reqTimeout: 30, endpoint: tencentEndpoint('cvm', handle.site) } },
  })
}

/** CVM has its own region set (broader than TKE), so discover it via CVM. */
async function getCvmRegions(handle: TencentHandle): Promise<string[]> {
  const resp = await cvmClient(tencentBootstrapRegion(handle.site), handle).DescribeRegions()

  return (
    (resp.RegionSet ?? [])
      // Only scan regions CVM marks AVAILABLE; never filter on a status we can't
      // be sure of, or we'd silently skip the user's region.
      .filter((r) => (r.RegionState ?? 'AVAILABLE') === 'AVAILABLE')
      .map((r) => r.Region)
      .filter((name): name is string => Boolean(name))
  )
}

type RawCvmInstance = NonNullable<
  Awaited<ReturnType<InstanceType<typeof CvmClient>['DescribeInstances']>>['InstanceSet']
>[number]

function mapInstance(inst: RawCvmInstance, region: string): TencentCvmInstance | null {
  if (!inst.InstanceId) return null

  return {
    instanceId: inst.InstanceId,
    name: inst.InstanceName || inst.InstanceId,
    instanceType: inst.InstanceType ?? '',
    state: inst.InstanceState ?? 'UNKNOWN',
    region,
    zone: inst.Placement?.Zone ?? '',
    publicIp: inst.PublicIpAddresses?.[0] ?? null,
    privateIp: inst.PrivateIpAddresses?.[0] ?? null,
    cpu: typeof inst.CPU === 'number' ? inst.CPU : null,
    memoryGb: typeof inst.Memory === 'number' ? inst.Memory : null,
    osName: inst.OsName ?? null,
    imageId: inst.ImageId ?? null,
    createdAt: inst.CreatedTime ?? null,
  }
}

/**
 * List the team's CVM instances across every available region. Mirrors
 * `listTkeClusters` / `listEc2Instances`: bounded-concurrency region sweep,
 * per-region rate-limit retry, partial results + per-region errors, but throws
 * a 403 when access is denied everywhere so the UI can point at the CAM policy.
 */
export async function listCvmInstances(
  handle: TencentHandle,
): Promise<{ instances: TencentCvmInstance[]; errors: TencentCvmListError[] }> {
  let regions: string[]

  try {
    regions = await getCvmRegions(handle)
  } catch (e) {
    if (isTencentAuthError(e)) {
      throw new AppError(
        403,
        'tencent_permission_denied',
        'The Tencent credentials lack permission to list regions/instances.',
        {
          provider: 'tencent',
          operation: 'cvm:DescribeRegions',
          upstreamMessage: (e as Error).message,
        },
      )
    }

    return {
      instances: [],
      errors: [{ message: `DescribeRegions failed: ${(e as Error).message}` }],
    }
  }

  const instances: TencentCvmInstance[] = []
  const errors: TencentCvmListError[] = []
  const rawErrors: unknown[] = []

  await mapLimit(regions, REGION_SCAN_CONCURRENCY, async (region) => {
    try {
      const client = cvmClient(region, handle)
      let offset = 0

      // Page through the region (CVM caps Limit at 100). The retry recovers any
      // page that trips CVM's per-second request limit.
      for (;;) {
        const resp = await withTencentRateLimitRetry(() =>
          client.DescribeInstances({ Limit: CVM_PAGE_LIMIT, Offset: offset }),
        )
        const set = resp.InstanceSet ?? []

        for (const inst of set) {
          const mapped = mapInstance(inst, region)

          if (mapped) instances.push(mapped)
        }
        offset += set.length
        if (set.length < CVM_PAGE_LIMIT || offset >= (resp.TotalCount ?? offset)) break
      }
    } catch (e) {
      // DescribeRegions lists some regions where CVM/DescribeInstances isn't
      // actually offered — skip those silently rather than surfacing noise.
      if (/UnsupportedRegion/i.test(tencentErrorCode(e))) return
      rawErrors.push(e)
      errors.push({ region, message: (e as Error).message })
    }
  })

  if (instances.length === 0) {
    const denied = rawErrors.find(isTencentAuthError)

    if (denied) {
      throw new AppError(
        403,
        'tencent_permission_denied',
        'The Tencent credentials do not have permission to DescribeInstances.',
        {
          provider: 'tencent',
          operation: 'cvm:DescribeInstances',
          upstreamMessage: errorMessage(denied),
        },
      )
    }
  }

  return { instances, errors }
}
