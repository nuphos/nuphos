import { apiUrl } from '../api-endpoint.ts'
import { authSession } from '../auth-session.ts'
import { decideAuthStatus, isTokenRejected, isValidUserInfo } from '../auth-status.ts'

import { readConfig, writeConfig } from './config.ts'

import type { AuthSession } from '../auth-session.ts'
import type { AuthStatus, MeProbe, UserInfo } from '../auth-status.ts'
import type { Config } from './config.ts'

// Bounded so a half-open connection / hung server can't leave the renderer
// stuck on the "checking" splash forever — a timeout aborts the fetch, which
// surfaces as a transient probe (keep the session, retry next launch).
const AUTH_ME_TIMEOUT_MS = 10_000

export async function fetchUserInfo(token: string): Promise<UserInfo> {
  const res = await fetch(`${apiUrl()}/auth/me`, {
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
  writeConfig: (cfg: Config) => Promise<void>
  probe: (token: string) => Promise<MeProbe>
  session: AuthSession
}

const defaultStatusDeps: StatusDeps = {
  readConfig,
  writeConfig,
  probe: probeMe,
  session: authSession,
}

export async function status(deps: StatusDeps = defaultStatusDeps): Promise<AuthStatus> {
  const result = await probeStatus(deps)

  deps.session.set(result.loggedIn ? result.token : null)

  return result
}

async function probeStatus(deps: StatusDeps): Promise<AuthStatus> {
  const cfg = await deps.readConfig()

  if (!cfg.token) return { loggedIn: false }

  const probe = await deps.probe(cfg.token)

  if (probe.ok) {
    // Keep the cached identity fresh so a later transient failure has an
    // up-to-date user to fall back on. Best-effort: a failed write (disk full,
    // permissions, race) must NOT downgrade a valid login to anonymous.
    try {
      await deps.writeConfig({
        ...cfg,
        user: probe.user.name,
        username: probe.user.username,
        userInfo: probe.user,
      })
    } catch (e) {
      console.warn('auth: failed to refresh cached identity', e)
    }
  } else if (!probe.transient) {
    try {
      await deps.writeConfig({})
    } catch (e) {
      console.warn('auth: failed to clear rejected token', e)
    }
  }

  return decideAuthStatus(probe, cfg.token, cfg.userInfo)
}
