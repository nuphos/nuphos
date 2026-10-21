import { createServer } from 'node:http'

import { shell } from 'electron'

// Extension-qualified so this module also resolves under plain node ESM, which
// is how auth-login.test.ts drives login().
import { loginApiUrl, stageLoginApiUrl } from './api-endpoint.ts'
import { apiErrorMessage } from './auth/backend.ts'
import { listenOnLoopback } from './auth/callback-server.ts'
import { otherAccounts, signOutAllConfig, switchConfig, writeConfig } from './auth/config.ts'
import { completeLegacyLogin } from './auth/legacy.ts'
import { status } from './auth/me.ts'
import { completeNativeLogin } from './auth/native.ts'
import { planLogin } from './auth/plan.ts'
import { cancelSignIn, isCurrentAttempt, saveSignIn, signInAttempt } from './auth/sign-in.ts'
import type { SignInAttempt } from './auth/sign-in.ts'
import { isValidUserInfo } from './auth-status.ts'

import type { OtherAccount } from './auth/config.ts'
import type { AuthStatus, UserInfo } from './auth-status.ts'
import type { Server } from 'node:http'

export type { AuthStatus, OtherAccount, UserInfo }

export { status }

let pendingServer: Server | null = null

/**
 * Signs in through the system browser.
 *
 * Native path (RFC 8252): register this listener's loopback port with the
 * backend and send the browser straight to Google carrying only the resulting
 * handle. The redirect back to the listener carries a one-time `code`, which we
 * exchange — together with a PKCE verifier that never leaves this process — for
 * the session over TLS. No session token ever rides a redirect URL.
 *
 * Legacy path: the landing page delivers a token to the listener instead. Kept
 * for deployments without the native endpoints — see `planLogin`.
 */
export async function login(): Promise<UserInfo> {
  cancelPendingLogin()
  // Taken before the preflight, so a Cancel during it never opens a browser.
  const attempt = signInAttempt()
  const server = createServer()
  const port = await listenOnLoopback(server)

  pendingServer = server

  try {
    const plan = await planLogin(port)

    if (!isCurrentAttempt(attempt)) throw new Error('Sign-in cancelled')
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
// The attempt each window requested an email code in: the code is verified
// with the backend that sent it, by the window that asked for it, and not at
// all once that attempt is cancelled.
const emailCodeAttempts = new Map<number, { email: string; attempt: SignInAttempt }>()

export async function requestEmailCode(email: string, from: number): Promise<void> {
  const attempt = signInAttempt()

  emailCodeAttempts.set(from, { email, attempt })
  const res = await fetch(`${attempt.api}/auth/email/request-code`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
    signal: AbortSignal.timeout(20_000),
  })

  if (!res.ok) {
    throw new Error(await apiErrorMessage(res))
  }
}

export async function verifyEmailCode(
  email: string,
  code: string,
  from: number,
): Promise<UserInfo> {
  const requested = emailCodeAttempts.get(from)

  if (requested?.email !== email) throw new Error('Request a new code for this email')
  const { attempt } = requested

  if (!isCurrentAttempt(attempt)) throw new Error('Sign-in cancelled')
  const res = await fetch(`${attempt.api}/auth/email/verify-code`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
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

  await saveSignIn(attempt, {
    token,
    user: user.name,
    username: user.username,
    userInfo: user,
  })

  return user
}

export async function logout() {
  // A backend staged for adding an account (in any window) goes with it, so
  // the next sign-in is sent where the sign-in screen says.
  cancelAddAccount()
  await writeConfig({})
}

/** The other accounts signed in on this device, for the account menu. */
export function accounts(): Promise<OtherAccount[]> {
  return otherAccounts()
}

/**
 * Makes another signed-in account the current one. Its token is checked like
 * at startup: one the backend rejects leaves the list and signs out.
 */
export async function switchAccount(key: string): Promise<AuthStatus> {
  cancelPendingLogin()
  stageLoginApiUrl(null)
  await switchConfig(key)

  return status()
}

export async function logoutAll() {
  cancelPendingLogin()
  stageLoginApiUrl(null)
  await signOutAllConfig()
}

/** Cancels adding an account: drops the sign-in in progress and the backend staged for it. */
export function cancelAddAccount() {
  cancelPendingLogin()
  stageLoginApiUrl(null)
}

/**
 * Stages the backend the next sign-in goes to, without leaving the current
 * one. A sign-in already under way belongs to the previous backend, so it is
 * cancelled rather than saved on the new one.
 */
export function stageLoginEndpoint(url: string | null): string {
  cancelPendingLogin()

  return stageLoginApiUrl(url)
}

export function loginEndpoint(): string {
  return loginApiUrl()
}

/** Drops any sign-in in progress; one that completes afterwards is not saved. */
export function cancelPendingLogin() {
  cancelSignIn()
  if (pendingServer) {
    pendingServer.close()
    pendingServer = null
  }
}
