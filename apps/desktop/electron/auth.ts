import { createServer } from 'node:http'

import { shell } from 'electron'

// Extension-qualified so this module also resolves under plain node ESM, which
// is how auth-login.test.ts drives login().
import { apiUrl } from './api-endpoint.ts'
import { listenOnLoopback } from './auth/callback-server.ts'
import { apiErrorMessage, writeConfig } from './auth/config.ts'
import { completeLegacyLogin } from './auth/legacy.ts'
import { completeNativeLogin } from './auth/native.ts'
import { planLogin } from './auth/plan.ts'
import { isValidUserInfo } from './auth-status.ts'

import type { AuthStatus, UserInfo } from './auth-status.ts'
import type { Server } from 'node:http'

export type { AuthStatus, UserInfo }

export { status } from './auth/me.ts'

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

  const server = createServer()
  const port = await listenOnLoopback(server)

  pendingServer = server

  try {
    const plan = await planLogin(port)

    await shell.openExternal(plan.browserUrl)

    return plan.mode === 'native'
      ? await completeNativeLogin(server, plan)
      : await completeLegacyLogin(server, plan)
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
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
    signal: AbortSignal.timeout(20_000),
  })

  if (!res.ok) {
    throw new Error(await apiErrorMessage(res))
  }
}

export async function verifyEmailCode(email: string, code: string): Promise<UserInfo> {
  const res = await fetch(`${apiUrl()}/auth/email/verify-code`, {
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

  await writeConfig({
    token,
    user: user.name,
    username: user.username,
    userInfo: user,
  })

  return user
}

export async function logout() {
  if (pendingServer) {
    pendingServer.close()
    pendingServer = null
  }
  await writeConfig({})
}

export function cancelPendingLogin() {
  if (pendingServer) {
    pendingServer.close()
    pendingServer = null
  }
}
