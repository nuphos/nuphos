import { randomInt } from 'node:crypto'

/** Alibaba SDK errors carry a dotted `code` (e.g. InvalidAccessKeyId.NotFound). */
export function aliyunErrorCode(e: unknown): string {
  return (e as { code?: string })?.code ?? ''
}

export function isAliyunAuthError(e: unknown): boolean {
  const code = aliyunErrorCode(e)

  return /InvalidAccessKeyId|SignatureDoesNotMatch|Forbidden|NoPermission|NotAuthorized|InvalidSecurityToken/i.test(
    code,
  )
}

/**
 * The AccessKey itself is wrong (bad id or secret) — distinct from a valid key
 * that merely lacks a permission or hits an uninitialized service. Only this
 * should fail credential verification; everything else means the request
 * authenticated.
 */
export function isAliyunInvalidCredential(e: unknown): boolean {
  return /InvalidAccessKeyId|SignatureDoesNotMatch|InvalidSecurityToken/i.test(aliyunErrorCode(e))
}

/**
 * ACK's service-linked role isn't set up for this account (never used Container
 * Service). The key is valid and authenticated — the account just has no ACK
 * footprint yet, so there are simply no clusters to list.
 */
export function isAliyunAckNotInitialized(e: unknown): boolean {
  return (
    /EntityNotExist\.Role/i.test(aliyunErrorCode(e)) ||
    /aliyuncsdefaultrole|not been activated|not activated|service is not (open|enabled)/i.test(
      (e as Error)?.message ?? '',
    )
  )
}

export function isAliyunRateLimit(e: unknown): boolean {
  return (
    /Throttling|RequestLimitExceeded|ServiceUnavailable/i.test(aliyunErrorCode(e)) ||
    /throttl|rate limit|too many requests/i.test((e as Error)?.message ?? '')
  )
}

/**
 * Retry a call on Aliyun throttling. Exponential backoff with jitter so a burst
 * of throttled calls drains instead of re-bursting in lockstep. Shared by the
 * ACK and ECS paths.
 */
export async function withAliyunRateLimitRetry<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
  let lastErr: unknown

  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      if (!isAliyunRateLimit(e) || i === attempts - 1) throw e
      const backoff = 300 * 2 ** i + randomInt(400)

      await new Promise((r) => setTimeout(r, Math.min(backoff, 4000)))
    }
  }
  throw lastErr
}
