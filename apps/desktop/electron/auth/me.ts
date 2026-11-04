import { apiUrl } from '../api-endpoint.ts'
import { authSession } from '../auth-session.ts'
import { classifyMeFailure, decideAuthStatus, isValidUserInfo } from '../auth-status.ts'

import { OtherBackendError } from './accounts.ts'
import { commitConfigIf, readConfig } from './config.ts'

import type { AuthSession } from '../auth-session.ts'
import type { AuthStatus, MeProbe, UserInfo } from '../auth-status.ts'
import type { Config } from './config.ts'

// Bounded so a half-open connection / hung server can't leave the renderer
// stuck on the "checking" splash forever — a timeout aborts the fetch, which
// surfaces as a transient probe (keep the session, retry next launch).
const AUTH_ME_TIMEOUT_MS = 10_000

/** Who `token` is, asked of `api`, the backend that issued it. */
export async function fetchUserInfo(token: string, api: string = apiUrl()): Promise<UserInfo> {
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

// Probe GET /auth/me, classifying the outcome so status() can tell a credential
// the backend proved dead (clear the sign-in) apart from a refusal it cannot
// explain and a transient failure (both keep it). Never throws — a
// network/transport error, timeout, or malformed body is just a transient probe.
async function probeMe(token: string, api: string): Promise<MeProbe> {
  let res: Response

  try {
    res = await fetch(`${api}/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(AUTH_ME_TIMEOUT_MS),
    })
  } catch {
    // Offline, DNS failure, connection reset, or timeout — never proof the
    // token is dead.
    return { ok: false, failure: 'transient' }
  }
  if (!res.ok) {
    // The body, not the status, says whether the credential itself is dead: a
    // proxy's own 401 carries HTML, and a 403 never means an invalid session.
    let code: string | undefined

    try {
      const body = (await res.json()) as { error?: { code?: unknown } } | null

      if (typeof body?.error?.code === 'string') code = body.error.code
    } catch {
      // Not our JSON, so there is no code to trust.
    }

    return { ok: false, failure: classifyMeFailure(res.status, code), status: res.status }
  }
  let body: unknown

  try {
    body = await res.json()
  } catch {
    // 2xx with an unparseable body is a server hiccup, not a rejected token.
    return { ok: false, failure: 'transient' }
  }
  if (!isValidUserInfo(body)) {
    // 2xx but null / missing-field identity — malformed, treat as transient
    // rather than logging in a half-empty user.
    return { ok: false, failure: 'transient' }
  }

  return { ok: true, user: body }
}

export type StatusDeps = {
  readConfig: () => Promise<Config>
  /** Runs `task` in the config file's turn if `isCurrent` holds there (config.ts). */
  commitIf: <T>(
    isCurrent: () => boolean,
    task: (save: (cfg: Config) => Promise<void>) => Promise<T>,
  ) => Promise<T | null>
  /** Asks `api`, the backend that issued `token`, who it is. */
  probe: (token: string, api: string) => Promise<MeProbe>
  session: AuthSession
}

const defaultStatusDeps: StatusDeps = {
  readConfig,
  commitIf: commitConfigIf,
  probe: probeMe,
  session: authSession,
}

/**
 * Checks the stored sign-in with the backend. The check is bound to the
 * account it began as: if another one took over while `/auth/me` was out (a
 * switch, a sign-in, a sign-out), nothing it learned is written, to the file
 * or to the session, and the account now current is checked instead.
 */
export async function status(deps: StatusDeps = defaultStatusDeps): Promise<AuthStatus> {
  const start = deps.session.context()
  const isCurrent = () => deps.session.context().epoch === start.epoch
  const read = await deps.readConfig()
  // A file from before the app recorded its backend is the current one's.
  const cfg = { ...read, api: read.api ?? start.api }
  const probe = cfg.token ? await deps.probe(cfg.token, cfg.api) : null
  const result = await deps.commitIf(isCurrent, async (save) => {
    let outcome: AuthStatus

    try {
      outcome = await settle(cfg, probe, save)
    } catch (e) {
      // The backend moved while the file was written: check again from there.
      if (e instanceof OtherBackendError) return null
      throw e
    }
    // A new endpoint does not wait for this turn, so it may have landed while
    // the file was written: the session then belongs to that backend.
    if (!isCurrent()) return null
    if (outcome.loggedIn) deps.session.set(outcome.token, outcome.user.id)
    else deps.session.set(null, null)

    return outcome
  })

  return result ?? status(deps)
}

async function settle(
  cfg: Config,
  probe: MeProbe | null,
  save: (cfg: Config) => Promise<void>,
): Promise<AuthStatus> {
  if (!cfg.token || !probe) return { loggedIn: false }
  if (probe.ok) {
    // Keep the cached identity fresh so a later transient failure has an
    // up-to-date user to fall back on. Best-effort: a failed write (disk full,
    // permissions, race) must NOT downgrade a valid login to anonymous.
    try {
      await save({
        ...cfg,
        user: probe.user.name,
        username: probe.user.username,
        userInfo: probe.user,
      })
    } catch (e) {
      if (e instanceof OtherBackendError) throw e
      console.warn('auth: failed to refresh cached identity', e)
    }
  } else {
    const detail = probe.status === undefined ? 'no response' : `HTTP ${String(probe.status)}`

    if (probe.failure === 'invalid') {
      // The one outcome that ends the sign-in: the backend proved the credential
      // dead, so nothing here can succeed until the person signs in again.
      try {
        await save({})
        console.warn(`auth: cleared the saved session — the backend rejected the token (${detail})`)
      } catch (e) {
        console.warn('auth: failed to clear rejected token', e)
      }
    } else {
      // A refusal or a transient failure says nothing about the credential, so
      // the token stays for the next launch; only this launch is signed out
      // (or, when a user is cached, runs on the cached identity).
      console.warn(`auth: kept the saved session after a ${probe.failure} probe (${detail})`)
    }
  }

  return decideAuthStatus(probe, cfg.token, cfg.userInfo)
}
