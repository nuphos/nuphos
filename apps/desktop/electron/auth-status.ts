// Pure session-status logic, deliberately free of electron / node / fetch so it
// can be unit-tested directly (see auth-status.test.ts). auth.ts does the IO
// (read config, probe /auth/me) and feeds the outcome through here.

export type UserInfo = {
  id: string
  name: string
  email: string
  username: string
  avatarURL?: string
  language?: string
  createdAt?: string
}

export type AuthStatus = { loggedIn: false } | { loggedIn: true; user: UserInfo; token: string }

// Why GET /auth/me did not return a user:
//   invalid   -> the backend said the credential itself is dead (a 401 with its
//                own `unauthorized` code). The one outcome that clears the sign-in.
//   refused   -> a refusal that does not say the credential is dead: a 403, or a
//                401 no Nuphos backend wrote (a proxy, a WAF, a mid-deploy server).
//   transient -> nothing was learned: offline, DNS, timeout, 5xx, 429, unparseable.
export type MeProbeFailure = 'invalid' | 'refused' | 'transient'

export type MeProbe =
  { ok: true; user: UserInfo } | { ok: false; failure: MeProbeFailure; status?: number }

// Validates the /auth/me payload shape. A 2xx with a null / non-object / missing
// -field body is a malformed response, not a valid identity — callers treat it as
// transient rather than casting junk to UserInfo (which would either crash on
// `user.name` or surface a half-empty logged-in user).
export function isValidUserInfo(value: unknown): value is UserInfo {
  if (!value || typeof value !== 'object') return false
  const u = value as Record<string, unknown>

  return (
    typeof u.id === 'string' &&
    u.id.length > 0 &&
    typeof u.name === 'string' &&
    typeof u.email === 'string' &&
    typeof u.username === 'string'
  )
}

// The body code the backend's auth gate answers with when the credential itself
// is dead — "Invalid or expired token" (backend middleware/auth/core.ts).
const INVALID_SESSION_CODE = 'unauthorized'

// Only the backend's own `unauthorized` code proves the token is invalid. A 401
// without it, a 403, or any other status keeps the saved sign-in: the first two
// say nothing about whether the credential is valid, and the rest are transport
// or server hiccups. Only the invalid outcome ends a sign-in.
export function classifyMeFailure(status: number, code: string | undefined): MeProbeFailure {
  if (status !== 401 && status !== 403) return 'transient'
  if (status === 401 && code === INVALID_SESSION_CODE) return 'invalid'

  return 'refused'
}

// Decides the session state from a probe plus whatever identity we last cached.
// On a transient failure we keep the session alive using the cached user instead
// of bouncing a still-logged-in person to the login screen. A refusal or a dead
// credential (or a transient failure on the very first launch, when nothing is
// cached yet) falls through to logged-out, while the sign-in file keeps the token
// unless the credential was proven dead.
export function decideAuthStatus(
  probe: MeProbe,
  token: string,
  cachedUser: UserInfo | undefined,
): AuthStatus {
  if (probe.ok) return { loggedIn: true, user: probe.user, token }
  if (probe.failure === 'transient' && cachedUser)
    return { loggedIn: true, user: cachedUser, token }

  return { loggedIn: false }
}
