import { createServer } from 'node:http'

import { shell } from 'electron'

// Extension-qualified so this module also resolves under plain node ESM, which
// is how auth-login.test.ts drives login().
import { apiUrl, setApiUrl } from './api-endpoint.ts'
import { buildAtlasError } from './atlas/error.ts'
import { AccountUnavailableError } from './auth/accounts.ts'
import { listenOnLoopback } from './auth/callback-server.ts'
import { requestContext } from './auth/request-context.ts'
import { assertWanted, beginSignIn, cancelSignIns } from './auth/sign-in-attempt.ts'
import {
  forgetAccountConfig,
  forgetAllAccountConfigs,
  signOutConfig,
  listAccountConfigs,
  parkAccountConfig,
  switchAccountConfig,
  writeConfig,
} from './auth/config.ts'
import { unsavedReason } from './auth/unsaved.ts'
import { apiError, apiErrorMessage } from './auth/web.ts'
import { completeNativeLogin } from './auth/native.ts'
import { runPasskeyCeremony } from './auth/passkey.ts'
import { planLogin } from './auth/plan.ts'
import { isValidUserInfo } from './auth-status.ts'
import { CLIENT_VERSION_HEADER, CLIENT_VERSION_VALUE } from './client-version.ts'

import type { SocialOption, SocialProvider } from './auth/plan.ts'
import type { AuthStatus, UserInfo } from './auth-status.ts'
import type { Server } from 'node:http'

export type { AuthStatus, SocialOption, SocialProvider, UserInfo }

export { status } from './auth/me.ts'
export { socialProviders } from './auth/plan.ts'

let pendingServer: Server | null = null

/**
 * Signs in through the system browser.
 *
 * RFC 8252: register this listener's loopback port with the backend and send
 * the browser straight to the provider carrying only the resulting handle. The
 * redirect back to the listener carries a one-time `code`, which we exchange —
 * together with a PKCE verifier that never leaves this process — for the
 * session over TLS. No session token ever rides a redirect URL.
 */
export async function login(provider: SocialProvider): Promise<UserInfo> {
  cancelPendingLogin()
  const attempt = beginSignIn()
  const server = createServer()
  const port = await listenOnLoopback(server)

  pendingServer = server

  try {
    const plan = await planLogin(port, provider)

    await shell.openExternal(plan.browserUrl)

    return await completeNativeLogin(server, plan, attempt)
  } finally {
    server.close()
    if (pendingServer === server) pendingServer = null
  }
}

// Email OTP sign-in talks to the backend directly and receives the token in
// the JSON response — no browser round-trip or localhost callback needed.
export async function requestEmailCode(email: string): Promise<void> {
  const res = await fetch(`${apiUrl()}/auth/email/request-code`, {
    method: 'POST',
    // The code email names the app that asked for it.
    headers: { 'content-type': 'application/json', [CLIENT_VERSION_HEADER]: CLIENT_VERSION_VALUE },
    body: JSON.stringify({ email }),
    signal: AbortSignal.timeout(20_000),
  })

  if (!res.ok) {
    throw new Error(await apiErrorMessage(res))
  }
}

export async function verifyEmailCode(email: string, code: string): Promise<UserInfo> {
  return signInWith('/auth/email/verify-code', { email, code })
}

/**
 * The second step of a sign-in that answered `mfa_required`: the challenge it
 * carried and a code from the authenticator app (or a recovery code).
 */
export async function verifyMfa(mfaToken: string, code: string): Promise<UserInfo> {
  return signInWith('/auth/mfa/verify', { mfaToken, code })
}

/** The same step answered with a passkey, through nuphos.ai in the browser. */
export async function verifyMfaWithPasskey(mfaToken: string): Promise<UserInfo> {
  const res = await fetch(`${apiUrl()}/auth/mfa/verify/options`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [CLIENT_VERSION_HEADER]: CLIENT_VERSION_VALUE },
    body: JSON.stringify({ mfaToken }),
    signal: AbortSignal.timeout(20_000),
  })

  if (!res.ok) throw await apiError(res)
  const passkey = await runPasskeyCeremony('get', await res.json())

  return signInWith('/auth/mfa/verify', { mfaToken, passkey })
}

/** Posts a sign-in step that answers with `{ token, user }`, and keeps the session. */
async function signInWith(route: string, body: Record<string, unknown>): Promise<UserInfo> {
  const attempt = beginSignIn()
  // The token this returns is the backend's it was asked of, whatever the endpoint is by then.
  const api = apiUrl()
  const res = await fetch(`${api}${route}`, {
    method: 'POST',
    // The app's name labels this sign-in in the account's device list.
    headers: { 'content-type': 'application/json', [CLIENT_VERSION_HEADER]: CLIENT_VERSION_VALUE },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  })

  // Keeps the code, so `mfa_required` reaches the sign-in screen with its challenge.
  if (!res.ok) throw await apiError(res)
  const session = (await res.json().catch(() => null)) as { token?: unknown; user?: unknown } | null
  const token = typeof session?.token === 'string' ? session.token : null

  if (!token || !isValidUserInfo(session?.user)) {
    throw new Error('Malformed sign-in response')
  }
  const user = session.user

  assertWanted(attempt)
  try {
    await writeConfig({
      token,
      api,
      user: user.name,
      username: user.username,
      userInfo: user,
    })
  } catch (e) {
    const reason = unsavedReason(e)

    throw reason ? buildAtlasError(reason, 'sign_in_not_saved') : e
  }

  return user
}

export async function logout() {
  // A sign-in still out must not land after this one is gone.
  cancelPendingLogin()
  // The account removed here is the one whose session is ended: both are
  // decided in one turn of the sign-in file. Ending it is best effort.
  const ended = await signOutConfig()

  if (ended) await endServerSession(ended.api, ended.token)
}

/**
 * Points the app at another backend (`null` restores the launch-time one). A
 * sign-in belongs to the backend that issued it, so it stops being the active
 * one, on disk as well as in memory: no launch sends it to the new backend.
 * It stays signed in there, waiting in the account list.
 */
export async function changeBackend(url: string | null): Promise<string> {
  const { api } = await requestContext()
  const next = setApiUrl(url)

  if (next !== api) await parkAccountConfig(api)

  return next
}

/** The accounts signed in on this computer, the active one first; never their tokens. */
export const listAccounts = listAccountConfigs

/**
 * Makes another signed-in account the active one, on the backend that issued
 * its token. One whose token is gone (a locked or cleared keychain) is signed
 * out of this app instead, to be signed in again.
 */
export async function switchAccount(key: string): Promise<'switched' | 'signInAgain'> {
  // A sign-in still out in another window must not replace the account chosen here.
  cancelPendingLogin()
  try {
    await switchAccountConfig(key)

    return 'switched'
  } catch (e) {
    if (!(e instanceof AccountUnavailableError)) throw e
    await signOutAccount(key)

    return 'signInAgain'
  }
}

/** Signs one account out of this app and ends its session on its backend. */
export async function signOutAccount(key: string): Promise<void> {
  const active = (await listAccounts()).find((a) => a.active)

  if (active?.key === key) return logout()
  const ended = await forgetAccountConfig(key)

  if (ended) void endServerSession(ended.api, ended.token)
}

/** Signs every account out of this app, the active one last. */
export async function signOutAllAccounts(): Promise<void> {
  cancelPendingLogin()
  // In one turn of the sign-in file, so a switch from another window cannot
  // slip an account past it.
  for (const { api, token } of await forgetAllAccountConfigs()) void endServerSession(api, token)
}

async function endServerSession(api: string, token: string): Promise<void> {
  await fetch(`${api}/auth/sessions/current`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5_000),
  }).catch(() => undefined)
}

export function cancelPendingLogin() {
  cancelSignIns()
  if (pendingServer) {
    pendingServer.close()
    pendingServer = null
  }
}
