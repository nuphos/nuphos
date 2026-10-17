// A Mac's Screen Sharing asks for an account on that Mac before it shows the
// screen; a Box's desktop never does. The account is kept for the view's
// reconnects only, and forgotten once the Mac refuses it.

import { useRef, useState } from 'react'

import type { MacAccount } from '../views/MacSignIn'
import type RFB from '@novnc/novnc'

/** Answers a desktop's request for an account; `asking` while the viewer must sign in. */
export function useMacSignIn() {
  const accountRef = useRef<MacAccount | null>(null)
  const rfbRef = useRef<RFB | null>(null)
  const [asking, setAsking] = useState<{ failed: boolean } | null>(null)

  const watch = (rfb: RFB) => {
    rfbRef.current = rfb
    rfb.addEventListener('connect', () => setAsking(null))
    rfb.addEventListener('credentialsrequired', () => {
      if (accountRef.current) rfb.sendCredentials(accountRef.current)
      else setAsking((asked) => asked ?? { failed: false })
    })
    rfb.addEventListener('securityfailure', () => {
      if (!accountRef.current) return
      accountRef.current = null
      setAsking({ failed: true })
    })
  }
  const submit = (account: MacAccount) => {
    accountRef.current = account
    setAsking(null)
    rfbRef.current?.sendCredentials(account)
  }

  return { watch, asking, submit }
}
