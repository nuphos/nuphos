// A Mac's Screen Sharing asks for an account on that Mac before it shows the
// screen; a Box's desktop never does. An accepted account is kept in this
// window's memory only, for the one target it was typed for (Mac device and
// display), so reconnects and later tabs on that Mac do not ask again. A
// refusal, signing out or quitting forgets it. It never reaches the backend or disk.

import { useEffect, useRef, useState } from 'react'

import type { MacAccount } from '../views/MacSignIn'
import type RFB from '@novnc/novnc'

/** The sign-in form while one is needed: `failed` once the Mac refused an account. */
export type SignInPrompt = { failed: boolean; username: boolean } | null

type Connection = Pick<RFB, 'addEventListener' | 'sendCredentials'>

const accepted = new Map<string, MacAccount>()

/** Forgets every kept account; signing out calls it. */
export function forgetMacAccounts(): void {
  accepted.clear()
}

/** Keeps the account typed for `target` until that Mac refuses it, sign-out or quit. */
export function keepAccount(target: string, account: MacAccount): void {
  accepted.set(target, account)
}

/** Follows one connection's sign-in; its events stop counting once it is no longer current. */
export function watchSignIn(
  rfb: Connection,
  {
    current,
    target,
    ask,
  }: {
    current: () => boolean
    /** The Mac's device and display; none means nothing is kept. */
    target: () => string | undefined
    ask: (next: (prompt: SignInPrompt) => SignInPrompt) => void
  },
): void {
  rfb.addEventListener('connect', () => {
    if (current()) ask(() => null)
  })
  rfb.addEventListener('credentialsrequired', (event) => {
    if (!current()) return
    const key = target()
    const saved = key ? accepted.get(key) : undefined

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
    const key = target()

    if (key) accepted.delete(key)
    ask(() => ({ failed: true, username: true }))
  })
}

/** `watch` each connection; `reset` when the view moves to another desktop. */
export function useMacSignIn(target: string | undefined) {
  const rfbRef = useRef<RFB | null>(null)
  const targetRef = useRef(target)
  const [asking, setAsking] = useState<SignInPrompt>(null)

  useEffect(() => {
    targetRef.current = target
  }, [target])
  const watch = (rfb: RFB) => {
    rfbRef.current = rfb
    watchSignIn(rfb, {
      current: () => rfbRef.current === rfb,
      target: () => targetRef.current,
      ask: setAsking,
    })
  }
  const reset = () => {
    rfbRef.current = null
    setAsking(null)
  }
  const submit = (account: MacAccount) => {
    if (targetRef.current) keepAccount(targetRef.current, account)
    setAsking(null)
    rfbRef.current?.sendCredentials(account)
  }

  return { watch, reset, asking, submit }
}
