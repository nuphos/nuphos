import { useEffect, useState } from 'react'

import { api } from '../../../api'

import type { RuntimeControl } from './RuntimeSelector'
import type { ShareApprovalStatus } from '../../../api/device-types'

const POLL_MS = 5_000

/**
 * Whether this conversation waits for the owner of the teammate's computer it
 * runs on, or was declined there. Asked only while its agent is on a computer
 * shared at "Ask me first"; nothing to show otherwise.
 */
export function useShareApprovalWait(
  control: RuntimeControl | undefined,
  sessionId: string | undefined,
): 'pending' | 'denied' | null {
  const selected = control?.options?.find((instance) => instance.id === control.value?.id)
  // Already watched by the conversation: nothing more to ask.
  const given = control?.shareApproval
  const asks = given === undefined && selected?.local?.shared?.level === 'approve'
  const [answer, setAnswer] = useState<{ sessionId: string; status: ShareApprovalStatus } | null>(
    null,
  )

  useEffect(() => {
    if (!asks || !sessionId) return
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = () =>
      void api.localShareStatus(sessionId).then(
        (status) => {
          if (!live) return
          setAnswer({ sessionId, status })
          // Approved is final for this conversation: nothing more to watch.
          if (status !== 'approved') timer = setTimeout(load, POLL_MS)
        },
        () => {
          if (live) timer = setTimeout(load, POLL_MS)
        },
      )

    load()

    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [asks, sessionId])

  if (given !== undefined) return given
  if (!asks || !sessionId || answer?.sessionId !== sessionId) return null
  const { status } = answer

  return status === 'pending' || status === 'denied' ? status : null
}
