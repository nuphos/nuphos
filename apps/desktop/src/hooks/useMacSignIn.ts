// A Mac's Screen Sharing asks for an account on that Mac before it shows the
// screen; a Box's desktop never does. An accepted account is kept in this
// window's memory only, for the one target it was typed for (Mac device and
// display), so reconnects and later tabs on that Mac do not ask again. A
// refusal, signing out or quitting forgets it. It never reaches the backend or disk.

import { useState } from 'react'

import type { MacAccount } from '../views/MacSignIn'
import type RFB from '@novnc/novnc'

/** The sign-in form while one is needed: `failed` once the Mac refused an account. */
export type SignInPrompt = { failed: boolean; username: boolean } | null

type Connection = Pick<RFB, 'addEventListener' | 'sendCredentials'>
type Ask = (next: (prompt: SignInPrompt) => SignInPrompt) => void

const accepted = new Map<string, MacAccount>()

/** Forgets every kept account; signing out calls it. */
export function forgetMacAccounts(): void {
  accepted.clear()
}

/**
 * One view's sign-ins. Each connection carries the target it was opened for,
 * fixed for its life: its events, the account it is sent and the one kept for
 * it all use that target, never another connection's. Without a target nothing
 * is kept. Only the newest connection counts; `reset` drops it with its prompt.
 */
export function signInSession(ask: Ask) {
  let latest: { rfb: Connection; target?: string } | undefined

  return {
    watch: (rfb: Connection, target: string | undefined): void => {
      const connection = { rfb, target }
      const current = () => latest === connection

      latest = connection
      rfb.addEventListener('connect', () => {
        if (current()) ask(() => null)
      })
      rfb.addEventListener('credentialsrequired', (event) => {
        if (!current()) return
        const saved = target ? accepted.get(target) : undefined

        if (saved) {
          rfb.sendCredentials(saved)

          return
        }
        // VNC password auth asks for the password alone.
        const username = event.detail.types.includes('username')

        ask((prompt) => ({ failed: prompt?.failed ?? false, username }))
      })
      rfb.addEventListener('securityfailure', () => {
        if (!current()) return
        if (target) accepted.delete(target)
        ask(() => ({ failed: true, username: true }))
      })
    },
    reset: (): void => {
      latest = undefined
      ask(() => null)
    },
    submit: (account: MacAccount): void => {
      if (!latest) return
      if (latest.target) accepted.set(latest.target, account)
      ask(() => null)
      latest.rfb.sendCredentials(account)
    },
  }
}

/** `watch` each connection with its target; `reset` when the view moves to another desktop. */
export function useMacSignIn() {
  const [asking, setAsking] = useState<SignInPrompt>(null)
  const [session] = useState(() => signInSession(setAsking))

  return { ...session, asking }
}
