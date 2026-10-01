import { AppError } from '@/lib/errors'

import { impersonateSa } from './gcp'
import { gcpWifConfigured, gcpWifPrincipalForTeam } from './gcp-wif'

export async function fetchJson<T>(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{ ok: boolean; status: number; data: T | null; errorText: string | null }> {
  try {
    const res = await fetch(url, init)
    let data: T | null = null
    let errorText: string | null = null
    const text = await res.text()

    if (text) {
      try {
        const parsed = JSON.parse(text)

        if (res.ok) {
          data = parsed as T
        } else {
          errorText = typeof parsed?.error?.message === 'string' ? parsed.error.message : text
        }
      } catch {
        if (res.ok) data = text as unknown as T
        else errorText = text
      }
    }

    return { ok: res.ok, status: res.status, data, errorText }
  } catch (e) {
    // Transport failure (DNS, TLS, socket) — return as a soft error so callers
    // can preserve partial IAM results from sibling Promise.all branches.
    return {
      ok: false,
      status: 0,
      data: null,
      errorText: e instanceof Error ? e.message : String(e),
    }
  }
}

/**
 * Verify that this team's WIF principal can impersonate the customer service
 * account. A freshly-created Token Creator grant can take time to propagate, so
 * retry before rejecting an otherwise-correct binding.
 */
export async function verifyGcpWifImpersonation(
  serviceAccountEmail: string,
  teamId: string,
  /** Overridden only by tests, so the failure path doesn't sleep for 20s. */
  backoffMs: number[] = [2000, 3000, 5000, 10_000],
): Promise<void> {
  if (!gcpWifConfigured()) {
    throw new AppError(
      503,
      'gcp_federation_unavailable',
      'GCP workload identity federation is not configured on this server.',
    )
  }
  let lastErr: unknown

  for (let attempt = 0; attempt <= backoffMs.length; attempt++) {
    try {
      const impersonated = await impersonateSa(serviceAccountEmail, teamId)
      const tokenResp = await impersonated.getAccessToken()

      if (tokenResp.token) return
      lastErr = new Error('getAccessToken returned an empty token')
    } catch (e) {
      lastErr = e
    }
    if (attempt < backoffMs.length) {
      await new Promise((resolve) => setTimeout(resolve, backoffMs[attempt]))
    }
  }
  const message = lastErr instanceof Error ? lastErr.message : String(lastErr)

  throw new AppError(
    400,
    'gcp_service_account_not_impersonable',
    `Nuphos cannot impersonate ${serviceAccountEmail}. Grant the Service Account Token Creator role to ${gcpWifPrincipalForTeam(teamId)}, then bind again. A grant made just now can take up to a minute to take effect. (${message})`,
    { serviceAccountEmail },
  )
}

// Mint an impersonated access token for the SA, retrying with backoff. A
// freshly-granted iam.serviceAccountTokenCreator can take a bit to propagate in
// GCP, so a correct-but-just-made permission-admin grant would otherwise fail
// the bind preflight. Retries only cost time WHEN impersonation is failing;
// the common success path returns on the first attempt with no delay.
export async function impersonateWithRetry(
  serviceAccountEmail: string,
  teamId: string,
): Promise<string> {
  const backoffMs = [1000, 2000, 4000, 6000]
  let lastErr: unknown

  for (let attempt = 0; attempt <= backoffMs.length; attempt++) {
    try {
      const impersonated = await impersonateSa(serviceAccountEmail, teamId)
      const tokenResp = await impersonated.getAccessToken()

      if (tokenResp.token) return tokenResp.token
      lastErr = new Error('getAccessToken returned an empty token')
    } catch (e) {
      lastErr = e
    }
    if (attempt < backoffMs.length) {
      await new Promise((resolve) => setTimeout(resolve, backoffMs[attempt]))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

export async function permissionAdminHeaders(
  adminSaEmail: string,
  teamId: string,
): Promise<Record<string, string>> {
  const impersonated = await impersonateSa(adminSaEmail, teamId)
  const tokenResp = await impersonated.getAccessToken()

  if (!tokenResp.token)
    throw new Error('getAccessToken returned an empty token for the permission-admin SA')

  return {
    Authorization: `Bearer ${tokenResp.token}`,
    'Content-Type': 'application/json',
  }
}
