import { createServer } from 'node:http'

import { shell } from 'electron'

// Extension-qualified so this module also resolves under plain node ESM, which
// is how auth-login.test.ts drives login().
import { apiUrl, setApiUrl } from './api-endpoint.ts'
import { AccountUnavailableError } from './auth/accounts.ts'
import { listenOnLoopback } from './auth/callback-server.ts'
import { assertWanted, beginSignIn, cancelSignIns } from './auth/sign-in-attempt.ts'
import {
  forgetAccountConfig,
  listAccountConfigs,
  parkAccountConfig,
  requestContext,
  switchAccountConfig,
  writeConfig,
} from './auth/config.ts'
import { apiErrorMessage } from './auth/web.ts'
import { completeLegacyLogin } from './auth/legacy.ts'
import { completeNativeLogin } from './auth/native.ts'
import { planLogin } from './auth/plan.ts'
import { isValidUserInfo } from './auth-status.ts'
import { CLIENT_VERSION_HEADER, CLIENT_VERSION_VALUE } from './client-version.ts'

import type { SocialProvider } from './auth/plan.ts'
import type { AuthStatus, UserInfo } from './auth-status.ts'
import type { Server } from 'node:http'

export type { AuthStatus, SocialProvider, UserInfo }

export { status } from './auth/me.ts'
export { socialProviders } from './auth/plan.ts'

let pendingServer: Server | null = null

/**
 * Signs in through the system browser.
 *
 * Native path (RFC 8252): register this listener's loopback port with the
 * backend and send the browser straight to the provider carrying only the resulting
 * handle. The redirect back to the listener carries a one-time `code`, which we
 * exchange — together with a PKCE verifier that never leaves this process — for
 * the session over TLS. No session token ever rides a redirect URL.
 *
 * Legacy path: the landing page delivers a token to the listener instead. Kept
 * for deployments without the native endpoints — see `planLogin`.
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

    return plan.mode === 'native'
      ? await completeNativeLogin(server, plan, attempt)
      : await completeLegacyLogin(server, plan, attempt)
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
  const attempt = beginSignIn()
  // The token this returns is the backend's it was asked of, whatever the endpoint is by then.
  const api = apiUrl()
  const res = await fetch(`${api}/auth/email/verify-code`, {
    method: 'POST',
    // The app's name labels this sign-in in the account's device list.
    headers: { 'content-type': 'application/json', [CLIENT_VERSION_HEADER]: CLIENT_VERSION_VALUE },
    body: JSON.stringify({ email, code }),
    signal: AbortSignal.timeout(20_000),
  })

  if (!res.ok) {
    throw new Error(await apiErrorMessage(res))
  }
  const body = (await res.json().catch(() => null)) as { token?: unknown; user?: unknown } | null
  const token = typeof body?.token === 'string' ? body.token : null

  if (!token || !isValidUserInfo(body?.user)) {
    throw new Error('Malformed sign-in response')
  }
  const user = body.user

  assertWanted(attempt)
  await writeConfig({
    token,
    api,
    user: user.name,
    username: user.username,
    userInfo: user,
  })

  return user
}

export async function logout() {
  // A sign-in still out must not land after this one is gone.
  cancelPendingLogin()
  const { api, token } = await requestContext()

  // Signed out here first; ending the session on the server is best effort.
  await writeConfig({})
  if (token) await endServerSession(api, token)
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
  for (const account of await listAccounts()) {
    if (!account.active) await signOutAccount(account.key)
  }
  await logout()
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
