import { useCallback, useEffect, useState } from 'react'

import { api } from '../../api'

import { afterAnswer } from './shareTrust'

import type { LocalShareApproval, ShareTrustDuration } from '../../api/device-types'

export const SHARE_APPROVAL_POLL_MS = 10_000

/**
 * Teammates' conversations waiting for this person to let them run on their own
 * computer, in this team. `decide` answers one and drops it from the list.
 */
export function useShareApprovals(teamId: string) {
  const [approvals, setApprovals] = useState<LocalShareApproval[]>([])

  useEffect(() => {
    if (!teamId) return
    let live = true
    const load = () =>
      void api.localShareApprovals(teamId).then(
        (next) => {
          if (live) setApprovals(next)
        },
        () => {
          // Best effort: keep what is already shown.
        },
      )

    load()
    const interval = setInterval(load, SHARE_APPROVAL_POLL_MS)

    return () => {
      live = false
      clearInterval(interval)
      setApprovals([])
    }
  }, [teamId])

  const decide = useCallback(
    async (approval: LocalShareApproval, approve: boolean, trust?: ShareTrustDuration) => {
      await api.localShareDecide(approval.id, approve, trust)
      setApprovals((previous) => afterAnswer(previous, approval, trust))
    },
    [],
  )

  return { approvals, decide }
}
