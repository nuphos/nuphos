import { isValidUserInfo } from '../auth-status.ts'

import {
  CALLBACK_WAIT_INTERVAL_MS,
  LOGIN_TIMEOUT_MS,
  onCallback,
  SESSION_POLL_INTERVAL_MS,
} from './callback-server.ts'
import { apiErrorMessage, NUPHOS_URL, writeConfig } from './config.ts'
import { describeCallbackFailure, errorPage, SUCCESS_HTML } from './pages.ts'

import type { UserInfo } from '../auth-status.ts'
import type { CallbackHit } from './callback-server.ts'
import type { LoginPlan } from './plan.ts'
import type { Server } from 'node:http'

type RedeemOutcome =
  | { status: 'ready'; token: string; user: UserInfo }
  | { status: 'pending' }
  | { status: 'failed'; message: string }

async function redeemNativeSession(
  handle: string,
  codeVerifier: string,
  code: string,
): Promise<RedeemOutcome> {
  let res: Response

  try {
    res = await fetch(`${NUPHOS_URL}/auth/native/session/redeem`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle, codeVerifier, code }),
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    // A blip while polling says nothing — keep waiting rather than tearing
    // down a sign-in the user may have already completed.
    return { status: 'pending' }
  }

  if (res.status === 409) return { status: 'pending' }
  if (!res.ok) return { status: 'failed', message: await apiErrorMessage(res) }

  const body = (await res.json().catch(() => null)) as { token?: unknown; user?: unknown } | null

  if (typeof body?.token !== 'string' || !isValidUserInfo(body.user)) {
    return { status: 'failed', message: 'Malformed sign-in response' }
  }

  return { status: 'ready', token: body.token, user: body.user }
}

/**
 * Waits for the loopback redirect, then exchanges the `code` it carries for the
 * session.
 *
 * The wait is not optional and must never be worked around: the code is the
 * only thing tying this machine to the browser that just authenticated. The
 * handle and the verifier are both held by whoever registered the flow, which
 * on a lured sign-in is the attacker, not the person at the keyboard.
 */
export async function completeNativeLogin(
  server: Server,
  plan: Extract<LoginPlan, { mode: 'native' }>,
): Promise<UserInfo> {
  // An object rather than plain `let`s: TypeScript narrows those to their
  // initial values across the callback boundary, and the loop below reads them.
  const browser: { hit: CallbackHit | null; code: string | null; error: string | null } = {
    hit: null,
    code: null,
    error: null,
  }

  onCallback(server, plan.clientState, (received) => {
    if (received.params.get('error')) {
      const message = describeCallbackFailure(received.params)

      browser.error = message
      received.respond(400, errorPage(message))

      return
    }
    const code = received.params.get('code')

    if (!code) {
      browser.error = 'Sign-in did not complete — please try again'
      received.respond(400, errorPage(browser.error))

      return
    }
    browser.code = code
    // Hold the response open; it becomes the success page once the session is
    // actually in hand, so the tab never says "logged in" before we are.
    browser.hit = received
  })

  const deadline = Date.now() + LOGIN_TIMEOUT_MS

  while (Date.now() < deadline) {
    if (browser.error) throw new Error(browser.error)

    // Retried rather than done once, so a network blip on the exchange does not
    // throw away a sign-in the user has already completed.
    if (browser.code) {
      const outcome = await redeemNativeSession(plan.handle, plan.codeVerifier, browser.code)

      if (outcome.status === 'failed') {
        browser.hit?.respond(500, errorPage(outcome.message))
        throw new Error(outcome.message)
      }
      if (outcome.status === 'ready') {
        await writeConfig({
          token: outcome.token,
          user: outcome.user.name,
          username: outcome.user.username,
          userInfo: outcome.user,
        })
        browser.hit?.respond(200, SUCCESS_HTML)

        return outcome.user
      }
      await new Promise((r) => setTimeout(r, SESSION_POLL_INTERVAL_MS))
      continue
    }

    await new Promise((r) => setTimeout(r, CALLBACK_WAIT_INTERVAL_MS))
  }

  browser.hit?.respond(408, errorPage('Nuphos gave up waiting for this sign-in.'))
  throw new Error('Login timed out')
}
