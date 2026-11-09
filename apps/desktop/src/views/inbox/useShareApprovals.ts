import { useCallback, useSyncExternalStore } from 'react'

import { api } from '../../api'
import { pollSnapshot, refreshPoll, subscribePoll } from '../../hooks/sharedPoll'

import type { LocalShareApproval, ShareTrustDuration } from '../../api/device-types'

const SHARE_APPROVAL_POLL_MS = 10_000
const NONE: LocalShareApproval[] = []

/**
 * Teammates' conversations waiting for this person to let them run on their own
 * computer, in this team. One poll per team serves every caller. `decide` answers
 * one and reloads; approving with trust also settles that teammate's other asks.
 */
export function useShareApprovals(teamId: string) {
  const key = teamId ? `share-approvals:${teamId}` : undefined
  const subscribe = useCallback(
    (listener: () => void) =>
      key
        ? subscribePoll(
            key,
            () => api.localShareApprovals(teamId),
            SHARE_APPROVAL_POLL_MS,
            listener,
            // A new ask is notified, so it is read in the background too.
            true,
          )
        : () => {},
    [teamId, key],
  )
  const approvals =
    useSyncExternalStore(subscribe, () => pollSnapshot<LocalShareApproval[]>(key)).value ?? NONE

  const decide = useCallback(
    async (approval: LocalShareApproval, approve: boolean, trust?: ShareTrustDuration) => {
      await api.localShareDecide(approval.id, approve, trust)
      if (key) refreshPoll(key)
    },
    [key],
  )

  return { approvals, decide }
}
