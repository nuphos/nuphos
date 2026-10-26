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

// The outcome of probing GET /auth/me with a stored token:
//   ok                       -> the server returned the user (token is valid)
//   !ok + transient = false  -> the server actively rejected the token (401/403),
//                               a real logout; the token is dead.
//   !ok + transient = true   -> network down / 5xx / timeout / unparseable body —
//                               says nothing about whether the token is valid, so
//                               we must NOT treat it as a logout.
export type MeProbe = { ok: true; user: UserInfo } | { ok: false; transient: boolean }

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

// Only an explicit 401/403 means the token was rejected. Any other non-2xx
// (5xx, 429, 408, 404, …) is a server/transport hiccup — treat it as transient
// so a blip on api.nuphos.ai doesn't log the user out.
export function isTokenRejected(httpStatus: number): boolean {
  return httpStatus === 401 || httpStatus === 403
}

// Decides the session state from a probe plus whatever identity we last cached.
// On a transient failure we keep the session alive using the cached user instead
// of bouncing a still-logged-in person to the login screen. A real rejection
// (or a transient failure on the very first launch, when nothing is cached yet)
// falls through to logged-out.
export function decideAuthStatus(
  probe: MeProbe,
  token: string,
  cachedUser: UserInfo | undefined,
): AuthStatus {
  if (probe.ok) return { loggedIn: true, user: probe.user, token }
  if (probe.transient && cachedUser) return { loggedIn: true, user: cachedUser, token }

  return { loggedIn: false }
}
