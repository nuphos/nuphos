import { parseCallbackUser } from '../auth-status.ts'

import { LOGIN_TIMEOUT_MS, onCallback } from './callback-server.ts'
import { writeConfig } from './config.ts'
import { fetchUserInfo } from './me.ts'
import { describeCallbackFailure, errorPage, SUCCESS_HTML } from './pages.ts'

import type { UserInfo } from '../auth-status.ts'
import type { LoginPlan } from './plan.ts'
import type { Server } from 'node:http'

/** The landing page delivers a token straight to our loopback listener. */
export async function completeLegacyLogin(
  server: Server,
  plan: Extract<LoginPlan, { mode: 'legacy' }>,
): Promise<UserInfo> {
  return new Promise<UserInfo>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Login timed out')), LOGIN_TIMEOUT_MS)

    onCallback(server, plan.clientState, (received) => {
      void (async () => {
        try {
          const error = received.params.get('error')

          if (error) {
            received.respond(400, errorPage(describeCallbackFailure(received.params)))
            clearTimeout(timeout)
            reject(new Error(error))

            return
          }

          const token = received.params.get('token')

          if (!token) {
            received.respond(400, 'invalid request', 'text/plain')

            return
          }

          // Resolve and persist the identity BEFORE the success page renders:
          // anything that fails here must fail the sign-in visibly rather than
          // leave the browser claiming success with the token dropped.
          const user =
            parseCallbackUser(received.params.get('user'), token) ?? (await fetchUserInfo(token))

          await writeConfig({
            token,
            user: user.name,
            username: user.username,
            userInfo: user,
          })

          received.respond(200, SUCCESS_HTML)
          clearTimeout(timeout)
          resolve(user)
        } catch (e) {
          received.respond(500, errorPage('Nuphos could not finish the sign-in. Please try again.'))
          clearTimeout(timeout)
          reject(e instanceof Error ? e : new Error(String(e)))
        }
      })()
    })

    server.once('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })
}
