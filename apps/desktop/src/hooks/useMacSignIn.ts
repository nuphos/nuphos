// A Mac's Screen Sharing asks for an account on that Mac before it shows the
// screen; a Box's desktop never does. The account goes to the one connection
// that asked and is never kept: a reconnect, or another desktop, asks again.

import { useRef, useState } from 'react'

import type { MacAccount } from '../views/MacSignIn'
import type RFB from '@novnc/novnc'

/** The sign-in form while one is needed; `failed` once the Mac refused an account. */
export type SignInPrompt = { failed: boolean } | null

type Connection = Pick<RFB, 'addEventListener'>

/** Follows one connection's sign-in; its events stop counting once it is no longer current. */
export function watchSignIn(
  rfb: Connection,
  current: () => boolean,
  ask: (next: (prompt: SignInPrompt) => SignInPrompt) => void,
): void {
  rfb.addEventListener('connect', () => {
    if (current()) ask(() => null)
  })
  rfb.addEventListener('credentialsrequired', () => {
    if (current()) ask((prompt) => prompt ?? { failed: false })
  })
  rfb.addEventListener('securityfailure', () => {
    if (current()) ask(() => ({ failed: true }))
  })
}

/** `watch` each connection; `reset` when the view moves to another desktop. */
export function useMacSignIn() {
  const rfbRef = useRef<RFB | null>(null)
  const [asking, setAsking] = useState<SignInPrompt>(null)

  const watch = (rfb: RFB) => {
    rfbRef.current = rfb
    watchSignIn(rfb, () => rfbRef.current === rfb, setAsking)
  }
  const reset = () => {
    rfbRef.current = null
    setAsking(null)
  }
  const submit = (account: MacAccount) => {
    setAsking(null)
    rfbRef.current?.sendCredentials(account)
  }

  return { watch, reset, asking, submit }
}
