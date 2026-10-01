import { randomInt } from 'node:crypto'

import { Service } from '@volcengine/openapi'

import { SWEEP_READ_TIMEOUT_MS } from './aliyun'

/**
 * Short-lived credentials used for VKE/ECS calls, obtained via OIDC web-identity
 * federation (like AWS): Nuphos mints a per-team token and calls
 * sts:AssumeRoleWithOIDC into the customer's role. The SessionToken accompanies
 * the temporary AK/SK.
 */
export type VolcengineHandle = {
  accessKeyId: string
  secretAccessKey: string
  sessionToken: string
}

/** VKE's OpenAPI version (JSON-body actions at open.volcengineapi.com). */
export const VKE_VERSION = '2022-05-12'

/**
 * Volcengine's SDK never rejects on HTTP status (validateStatus: null) — API
 * errors come back in-band as ResponseMetadata.Error. Normalize that into a
 * thrown Error carrying a dotted `code`, matching the Tencent/Aliyun adapters
 * so the shared isXxxError predicates read uniformly.
 */
export type VolcResponse<T> = {
  ResponseMetadata?: {
    RequestId?: string
    Error?: { Code?: string; CodeN?: number; Message: string }
  }
  Result?: T
}

class VolcApiError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

export function unwrapVolcResult<T>(resp: VolcResponse<T>, operation: string): T | undefined {
  const err = resp?.ResponseMetadata?.Error

  if (err) {
    throw new VolcApiError(
      err.Code ?? String(err.CodeN ?? 'UnknownError'),
      `${operation}: ${err.Message}`,
    )
  }

  return resp?.Result
}

export function volcErrorCode(e: unknown): string {
  return (e as { code?: string })?.code ?? ''
}

export function isVolcAuthError(e: unknown): boolean {
  return /AccessDenied|Forbidden|NoPermission|UnauthorizedOperation|PolicyDenied|WithoutPermission|AccessKeyDisabled/i.test(
    volcErrorCode(e),
  )
}

/**
 * The AccessKey itself is wrong (bad id or secret) — distinct from a valid key
 * that merely lacks a permission. Only this should fail credential
 * verification; any other business response proves the request authenticated.
 */
export function isVolcInvalidCredential(e: unknown): boolean {
  return /InvalidAccessKey|SignatureDoesNotMatch|InvalidSecurityToken|InvalidCredential|AuthFailure/i.test(
    volcErrorCode(e),
  )
}

/**
 * The gateway rejects service/region pairs where the service isn't offered
 * ("The requested endpoint is invalid or does not match the requested service
 * or region."). During a sweep across the account's ECS regions this is
 * routine for VKE — treat it as "region not supported", not an error.
 */
export function isVolcRegionUnsupported(e: unknown): boolean {
  return (
    /InvalidEndpoint|EndpointInvalid/i.test(volcErrorCode(e)) ||
    /endpoint is invalid or does not match/i.test((e as Error)?.message ?? '')
  )
}

export function isVolcRateLimit(e: unknown): boolean {
  return (
    /Throttling|FlowLimitExceeded|RequestLimitExceeded|TooManyRequests/i.test(volcErrorCode(e)) ||
    /rate limit|too many requests/i.test((e as Error)?.message ?? '')
  )
}

/** Retry a call on Volcengine throttling — exponential backoff with jitter. */
export async function withVolcRateLimitRetry<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
  let lastErr: unknown

  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      if (!isVolcRateLimit(e) || i === attempts - 1) throw e
      const backoff = 300 * 2 ** i + randomInt(400)

      await new Promise((r) => setTimeout(r, Math.min(backoff, 4000)))
    }
  }
  throw lastErr
}

/**
 * Signed caller for one Volcengine service in one region, via the
 * service-scoped regional gateway `<service>.<region>.volcengineapi.com`. The
 * shared `open.volcengineapi.com` gateway does NOT serve every region — newer
 * overseas regions (e.g. ap-southeast-3 / Jakarta) reject it with
 * "endpoint invalid or does not match the requested service or region", while
 * the regional hosts exist for all regions. `json: true` posts a JSON body
 * (VKE's style); GET puts the flat request data in the query string (ECS's).
 */
export function volcCall<T>(
  handle: VolcengineHandle,
  serviceName: string,
  region: string,
  action: string,
  version: string,
  requestData: Record<string, unknown>,
  opts?: { json?: boolean },
): Promise<T | undefined> {
  const svc = new Service({
    serviceName,
    region,
    host: `${serviceName}.${region}.volcengineapi.com`,
    accessKeyId: handle.accessKeyId,
    secretKey: handle.secretAccessKey,
    sessionToken: handle.sessionToken,
  })
  const api = svc.createAPI(action, {
    Version: version,
    method: opts?.json ? 'POST' : 'GET',
    contentType: opts?.json ? 'json' : 'urlencode',
  })

  // `Action` in params is required by the SDK's type but overwritten by
  // createAPI with the created action; only `timeout` matters here.
  return api(requestData, { Action: action, timeout: SWEEP_READ_TIMEOUT_MS }).then((resp) =>
    unwrapVolcResult(resp as VolcResponse<T>, `${serviceName}:${action}`),
  )
}
