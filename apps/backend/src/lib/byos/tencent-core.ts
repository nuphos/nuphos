import { randomInt } from 'node:crypto'

import type { TencentSite } from './types'

/**
 * Short-lived Tencent Cloud STS credentials, obtained via OIDC web-identity
 * federation (like AWS/Aliyun/Volcengine): Nuphos mints a per-team token and
 * calls sts:AssumeRoleWithWebIdentity into the customer's CAM role. The `token`
 * accompanies the temporary secretId/secretKey. `site` picks the partition
 * (mainland China vs International) and therefore which endpoints/regions to hit.
 */
export type TencentHandle = {
  secretId: string
  secretKey: string
  token: string
  site: TencentSite
}

/**
 * Region used to bootstrap region discovery (DescribeRegions). Must be a region
 * the partition's credentials can actually authenticate against — international
 * accounts have no mainland regions, so ap-guangzhou would fail for them.
 */
export function tencentBootstrapRegion(site: TencentSite): string {
  return site === 'international' ? 'ap-singapore' : 'ap-guangzhou'
}

/**
 * Per-partition API endpoint for a service. International-site accounts are
 * served from the isolated `<svc>.intl.tencentcloudapi.com` domain; mainland
 * uses the SDK default (`<svc>.tencentcloudapi.com`), returned as undefined so
 * the SDK keeps its region-aware routing.
 */
export function tencentEndpoint(service: string, site: TencentSite): string | undefined {
  return site === 'international' ? `${service}.intl.tencentcloudapi.com` : undefined
}

/** Max regions scanned at once — keeps the cluster sweep well under TKE's ~20
 *  req/s so a concurrent kubeconfig fetch (also rate-limited) has headroom. */
export const REGION_SCAN_CONCURRENCY = 3

export type TkeListError = { region?: string; message: string }

/** Tencent SDK surfaces API errors as objects carrying a dotted `code`. */
export function tencentErrorCode(e: unknown): string {
  return (e as { code?: string })?.code ?? ''
}

export function isTencentAuthError(e: unknown): boolean {
  const code = tencentErrorCode(e)

  return /AuthFailure|UnauthorizedOperation|CamNoAuth|PermissionDenied/i.test(code)
}

export function isTencentRateLimit(e: unknown): boolean {
  return (
    /RequestLimitExceeded|LimitExceeded/i.test(tencentErrorCode(e)) ||
    /frequency limit|request times/i.test((e as Error)?.message ?? '')
  )
}

/**
 * Retry a Tencent API call on RequestLimitExceeded. The per-region resource scan
 * would otherwise drop the resource's own region to a transient rate-limit,
 * making the list flicker to empty. Backs off a little between attempts. Shared
 * by the TKE and CVM region sweeps.
 */
export async function withTencentRateLimitRetry<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
  let lastErr: unknown

  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      if (!isTencentRateLimit(e) || i === attempts - 1) throw e
      // Exponential backoff with jitter. The jitter is essential: without it,
      // a 19-region sweep that all trips the rate limit at once retries in
      // lockstep, re-bursting past 20/s every wave and starving any concurrent
      // kubeconfig fetch. Spreading the retries drains the limit instead.
      const backoff = 300 * 2 ** i + randomInt(400)

      await new Promise((r) => setTimeout(r, Math.min(backoff, 4000)))
    }
  }
  throw lastErr
}

/** Run async work over items with a bounded concurrency (rate-limit friendly). */
export async function mapLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('mapLimit limit must be a positive integer')
  }
  for (let i = 0; i < items.length; i += limit) {
    await Promise.all(items.slice(i, i + limit).map(fn))
  }
}
