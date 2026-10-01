import { decryptResendSecret } from '@/lib/byos/secrets'

import type { ResendIntegrationBinding } from '@/models'

// Resend REST API. Auth is a static `Authorization: Bearer re_…` API key pasted
// by the user — no OAuth, no token exchange, no expiry. Confirmed against
// resend.com/docs.
export const RESEND_API_BASE_URL = 'https://api.resend.com'
const FETCH_TIMEOUT_MS = 30_000

export class ResendApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    // Resend's machine-readable error name, e.g. `restricted_api_key`. Needed
    // because the status alone cannot tell a valid key from an invalid one.
    public readonly code: string | null = null,
  ) {
    super(message)
    this.name = 'ResendApiError'
  }
}

export function apiKeyFromBinding(binding: ResendIntegrationBinding): string {
  return decryptResendSecret(binding.encryptedApiKey)
}

async function resendGet(apiKey: string, path: string): Promise<unknown> {
  let res: Response

  try {
    res = await fetch(`${RESEND_API_BASE_URL}${path}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch (e) {
    const name = (e as { name?: string }).name

    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new ResendApiError(504, `Resend request timed out after ${String(FETCH_TIMEOUT_MS)}ms`)
    }
    const message = e instanceof Error ? e.message : 'unknown transport error'

    throw new ResendApiError(502, `Resend request failed: ${message}`)
  }
  if (!res.ok) {
    let detail = `HTTP ${String(res.status)}`
    let code: string | null = null

    try {
      const body = (await res.json()) as { message?: string; name?: string }

      code = typeof body.name === 'string' ? body.name : null
      detail = body.message || code || detail
    } catch {
      // non-JSON error body; keep the status-only detail
    }
    throw new ResendApiError(res.status, `Resend API error: ${detail}`, code)
  }

  return res.json()
}

// What the key is allowed to do, as reported by Resend itself. A sending-access
// key can ONLY POST /emails; every management read/write 401s.
export type ResendKeyPermission = 'full_access' | 'sending_access'

export type ResendKeyInfo = {
  permission: ResendKeyPermission
  // Verified sending domains, when the key can list them. Null for a
  // sending-access key, which is not allowed to read /domains at all.
  domains: string[] | null
}

// Validates an API key with a cheap read and reports what it can do.
//
// Resend inverts the usual status convention here, so the branches below are
// deliberate and must not be collapsed into Notion's "401/403 → invalid":
//   401 restricted_api_key → the key is VALID, just sending-access only.
//   403 invalid_api_key    → the key is genuinely bad.
// Treating 401 as invalid would reject every sending-only key, which is exactly
// the key a team should be handing to an agent that only needs to send mail.
export async function verifyResendApiKey(apiKey: string): Promise<ResendKeyInfo> {
  try {
    const body = (await resendGet(apiKey, '/domains')) as {
      data?: { name?: unknown; status?: unknown }[] | null
    }
    const domains = (body.data ?? [])
      .map((d) => (typeof d.name === 'string' ? d.name : null))
      .filter((name): name is string => name !== null)

    return { permission: 'full_access', domains }
  } catch (err) {
    if (err instanceof ResendApiError && err.status === 401 && err.code === 'restricted_api_key') {
      return { permission: 'sending_access', domains: null }
    }
    throw err
  }
}
