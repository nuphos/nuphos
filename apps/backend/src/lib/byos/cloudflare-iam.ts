import { cloudflareRequest } from './cloudflare'

import type { CloudflareAccountHandle } from './cloudflare'

export type CloudflareTokenPolicy = {
  /** Allow / deny — Cloudflare's `effect` field. */
  effect: string
  /** Resource scope as returned (e.g. `com.cloudflare.api.account.zone.<zoneId>`
   *  or `*` for "all resources of this type"). */
  resources: Record<string, string>
  /** Permission groups — human-readable names (e.g. "Zone DNS Edit"). */
  permissionGroups: { id: string; name: string; scopes?: string[] }[]
}

// OAuth-bound accounts (the current bind flow) don't have an inspectable API
// token — the meaningful facts are the granted scopes and whether the
// auto-refreshed access token can still reach the account.
export type CloudflareOauthConnection = {
  authType: 'oauth'
  accountId: string
  accountName: string | null
  clientId: string
  scopes: string[]
  /** When the current short-lived access token expires; it is auto-refreshed
   *  from the refresh token before then. */
  accessTokenExpiresAt: string | null
  hasRefreshToken: boolean
  /** Whether the access token can currently read the account. */
  connectionStatus: 'ok' | 'error'
  warnings: string[]
}

export async function getCloudflareOauthConnection(
  handle: CloudflareAccountHandle | null,
  meta: {
    accountId: string
    accountName: string | null
    clientId: string
    scope: string
    accessTokenExpiresAt: Date | null
    hasRefreshToken: boolean
  },
  warnings: string[] = [],
): Promise<CloudflareOauthConnection> {
  let connectionStatus: 'ok' | 'error' = handle ? 'ok' : 'error'

  if (handle) {
    try {
      await cloudflareRequest(handle, `/accounts/${encodeURIComponent(meta.accountId)}`)
    } catch (e) {
      connectionStatus = 'error'
      warnings.push(
        `Cloudflare /accounts/${meta.accountId} probe failed: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }

  return {
    authType: 'oauth',
    accountId: meta.accountId,
    accountName: meta.accountName,
    clientId: meta.clientId,
    scopes: meta.scope.split(/\s+/).filter(Boolean),
    accessTokenExpiresAt: meta.accessTokenExpiresAt?.toISOString() ?? null,
    hasRefreshToken: meta.hasRefreshToken,
    connectionStatus,
    warnings,
  }
}

export type CloudflareIamPermissions = {
  accountId: string
  /** Cloudflare token ID — distinct from the secret. Useful for support. */
  tokenId: string | null
  /** "active", "disabled", or "expired" per the verify endpoint. */
  tokenStatus: string | null
  /** Token name (often "Nuphos BYOC") if discoverable. */
  tokenName: string | null
  /** ISO timestamp when the token expires, or null if never. */
  expiresOn: string | null
  /** Membership of this token (read from /user/tokens/{id}). Null when we
   *  couldn't read it — typically because the token lacks
   *  `User Details: Read`. */
  policies: CloudflareTokenPolicy[] | null
  /** Soft warnings the UI can surface (e.g. "couldn't fetch token policies"). */
  warnings: string[]
  selfCapabilities: SelfCapabilities
}

/** Same contract as the AWS/GCP variants — see aws-iam.ts. */
export type SelfCapabilities = {
  canRead: boolean
  canWrite: boolean
  inferred: boolean
  readReason: string
  writeReason: string
}

type TokenVerifyResult = {
  id: string
  status: string
  not_before?: string
  expires_on?: string
}

type TokenDetailResult = {
  id: string
  name?: string
  status?: string
  expires_on?: string
  policies?: {
    effect?: string
    resources?: Record<string, string> | string[]
    permission_groups?: {
      id?: string
      name?: string
      scopes?: string[]
    }[]
  }[]
}

function normalizeResources(
  resources: Record<string, string> | string[] | undefined,
): Record<string, string> {
  if (!resources) return {}
  if (Array.isArray(resources)) {
    // Older Cloudflare responses may use a string array — normalize to "<r>": "*".
    return Object.fromEntries(resources.map((r) => [r, '*']))
  }

  return resources
}

export async function getCloudflareIamPermissions(
  handle: CloudflareAccountHandle,
): Promise<CloudflareIamPermissions> {
  const warnings: string[] = []

  let verify: TokenVerifyResult | null = null
  let verifyFailed = false
  // Remember exactly which warning entry came from /verify so we can drop it
  // later if the /accounts probe proves the token is fine. Naive .pop() would
  // remove whatever warning was pushed most recently, which may be the
  // detail-fetch warning instead.
  let verifyWarningIndex = -1

  try {
    verify = await cloudflareRequest<TokenVerifyResult>(handle, '/user/tokens/verify')
  } catch (e) {
    verifyFailed = true
    // Cloudflare returns "Invalid API Token" for account-scoped tokens calling
    // /user/* — known quirk, not a real failure. We probe /accounts/:id below
    // to distinguish "token is account-scoped" from "token is truly bad".
    const msg = e instanceof Error ? e.message : String(e)

    verifyWarningIndex = warnings.length
    warnings.push(`Cloudflare /user/tokens/verify failed: ${msg}`)
  }

  let detail: TokenDetailResult | null = null

  if (verify?.id) {
    try {
      detail = await cloudflareRequest<TokenDetailResult>(
        handle,
        `/user/tokens/${encodeURIComponent(verify.id)}`,
      )
    } catch (e) {
      warnings.push(
        `Cloudflare /user/tokens/${verify.id} failed (typically the token lacks "User Details: Read"): ${
          e instanceof Error ? e.message : String(e)
        }`,
      )
    }
  }

  // If verify rejected the token, fall back to /accounts/:id as a liveness
  // probe. Account-scoped tokens succeed here even though /user/* refuses
  // them — that's the well-known "Invalid API Token from /verify but the
  // token actually works" case.
  let accountScopedActive = false

  if (verifyFailed) {
    try {
      await cloudflareRequest<{ id: string }>(
        handle,
        `/accounts/${encodeURIComponent(handle.accountId)}`,
      )
      accountScopedActive = true
      // The verify failure was the harmless variant — drop the alarming
      // warning, since we have a confirmed working token. Target the
      // specific index so we don't accidentally remove the detail-fetch
      // warning that may have been pushed in between.
      if (verifyWarningIndex >= 0) {
        warnings.splice(verifyWarningIndex, 1)
      }
    } catch {
      // Real failure — keep the verify warning so the UI surfaces it.
    }
  }

  const policies: CloudflareTokenPolicy[] | null = detail?.policies
    ? detail.policies.map((p) => ({
        effect: p.effect ?? 'allow',
        resources: normalizeResources(p.resources),
        permissionGroups: (p.permission_groups ?? []).map((g) => ({
          id: g.id ?? '',
          name: g.name ?? g.id ?? '(unnamed)',
          ...(g.scopes ? { scopes: g.scopes } : {}),
        })),
      }))
    : null

  const tokenStatus = verify?.status ?? (accountScopedActive ? 'active' : null)
  const selfCapabilities = deriveCloudflareSelfCapabilities({
    policies,
    detailFetchWorked: detail !== null,
  })

  return {
    accountId: handle.accountId,
    tokenId: verify?.id ?? null,
    tokenStatus,
    tokenName: detail?.name ?? null,
    expiresOn: detail?.expires_on ?? verify?.expires_on ?? null,
    policies,
    warnings,
    selfCapabilities,
  }
}

function deriveCloudflareSelfCapabilities({
  policies,
  detailFetchWorked,
}: {
  policies: CloudflareTokenPolicy[] | null
  detailFetchWorked: boolean
}): SelfCapabilities {
  // Read = the token can fetch /user/tokens/{id} on itself. Authoritative
  // signal: did GET /user/tokens/{id} succeed?
  const canRead = detailFetchWorked
  const readReason = canRead
    ? 'Token successfully fetched its own policy list (includes the "User Details: Read" permission).'
    : 'Token could not fetch its own policy list — it lacks "User Details: Read" or is account-scoped (Cloudflare blocks /user/* for account-scoped tokens).'

  // Write = the token holds a permission group that could mint/edit tokens.
  // Cloudflare permission group names contain words like "Edit" + "API
  // Tokens" / "User Tokens". If we can't see policies, treat as unknown.
  if (!policies) {
    return {
      canRead,
      canWrite: false,
      inferred: true,
      readReason,
      writeReason:
        'Could not read token policies, so we cannot tell whether it can mint or edit tokens for itself.',
    }
  }
  const writeGroup = policies
    .filter((p) => p.effect === 'allow')
    .flatMap((p) => p.permissionGroups)
    .find((g) => /api token|user token/i.test(g.name) && /edit|write/i.test(g.name))
  const canWrite = !!writeGroup

  return {
    canRead,
    canWrite,
    inferred: false,
    readReason,
    writeReason: canWrite
      ? `Token includes the "${writeGroup!.name}" permission group, so you can rotate or edit this Nuphos token from within itself.`
      : "No token-management permission group is granted — you'll need to manage this token from the Cloudflare dashboard.",
  }
}
