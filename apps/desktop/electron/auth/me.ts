import { apiUrl } from '../api-endpoint.ts'
import { decideAuthStatus, isTokenRejected, isValidUserInfo } from '../auth-status.ts'

import { sameAccount } from './accounts.ts'
import { publishSessionIf, readConfig, writeConfigIf } from './config.ts'

import type { AuthStatus, MeProbe, UserInfo } from '../auth-status.ts'
import type { Config } from './config.ts'

// Bounded so a half-open connection / hung server can't leave the renderer
// stuck on the "checking" splash forever — a timeout aborts the fetch, which
// surfaces as a transient probe (keep the session, retry next launch).
const AUTH_ME_TIMEOUT_MS = 10_000

export async function fetchUserInfo(token: string, api = apiUrl()): Promise<UserInfo> {
  const res = await fetch(`${api}/auth/me`, {
    headers: {
      authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(AUTH_ME_TIMEOUT_MS),
  })

  if (!res.ok) {
    throw new Error(`HTTP ${String(res.status)}`)
  }
  const body = await res.json()

  if (!isValidUserInfo(body)) {
    throw new Error('Malformed /auth/me response')
  }

  return body
}

// Probe GET /auth/me, classifying the outcome so status() can tell a rejected
// token (real logout) apart from a transient failure (keep the session). Never
// throws — a network/transport error, timeout, or malformed body is just a
// transient probe.
async function probeMe(token: string): Promise<MeProbe> {
  let res: Response

  try {
    res = await fetch(`${apiUrl()}/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(AUTH_ME_TIMEOUT_MS),
    })
  } catch {
    // Offline, DNS failure, connection reset, or timeout — never proof the
    // token is dead.
    return { ok: false, transient: true }
  }
  if (!res.ok) {
    return { ok: false, transient: !isTokenRejected(res.status) }
  }
  let body: unknown

  try {
    body = await res.json()
  } catch {
    // 2xx with an unparseable body is a server hiccup, not a rejected token.
    return { ok: false, transient: true }
  }
  if (!isValidUserInfo(body)) {
    // 2xx but null / missing-field identity — malformed, treat as transient
    // rather than logging in a half-empty user.
    return { ok: false, transient: true }
  }

  return { ok: true, user: body }
}

export type StatusDeps = {
  readConfig: () => Promise<Config>
  /**
   * Applies a probe's outcome while the file still names the account `read`
   * was, in one turn with every other read and write of it: writes `next`
   * when there is one (which also sets the session), else makes `token` the
   * session. Resolves false, changing nothing, once another account took over.
   */
  commit: (read: Config, next: Config | null, token: string | null) => Promise<boolean>
  probe: (token: string) => Promise<MeProbe>
}

async function commitStatus(read: Config, next: Config | null, token: string | null) {
  const stillRead = (current: Config) => sameAccount(current, read, apiUrl())

  if (next) {
    try {
      return await writeConfigIf(next, stillRead)
    } catch (e) {
      // Best-effort: a failed write (disk full, permissions) must not
      // downgrade a valid sign-in, so the session is still published below.
      console.warn('auth: failed to update the sign-in after checking it', e)
    }
  }

  return publishSessionIf(token, stillRead)
}

const defaultStatusDeps: StatusDeps = {
  readConfig,
  commit: commitStatus,
  probe: probeMe,
}

/**
 * Checks the current sign-in with the backend and makes the session match.
 * When another window switches or adds an account while the check is out,
 * its answer is about an account no longer current, so the current one is
 * checked instead.
 */
export async function status(deps: StatusDeps = defaultStatusDeps): Promise<AuthStatus> {
  const cfg = await deps.readConfig()

  if (!cfg.token) {
    if (await deps.commit(cfg, null, null)) return { loggedIn: false }

    return status(deps)
  }
  const probe = await deps.probe(cfg.token)
  const result = decideAuthStatus(probe, cfg.token, cfg.userInfo)
  // Keep the cached identity fresh so a later transient failure has an
  // up-to-date user to fall back on; a rejected token signs out.
  const next: Config | null = probe.ok
    ? { ...cfg, user: probe.user.name, username: probe.user.username, userInfo: probe.user }
    : probe.transient
      ? null
      : {}

  if (await deps.commit(cfg, next, result.loggedIn ? result.token : null)) return result

  return status(deps)
}
