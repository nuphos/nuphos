import { useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '../../api'
import { queryKeys } from '../../lib/query/keys'

import type { LocalShareApproval, ShareTrustDuration } from '../../api/device-types'

const SHARE_APPROVAL_POLL_MS = 10_000
const NONE: LocalShareApproval[] = []

/**
 * Teammates' conversations waiting for this person to let them run on their own
 * computer, in this team. Only the always-mounted badge passes `poll`, also in the
 * background since a new ask is notified. `decide` answers one and reloads;
 * approving with trust also settles that teammate's other asks.
 */
export function useShareApprovals(teamId: string, { poll = false } = {}) {
  const client = useQueryClient()
  const queryKey = queryKeys.shareApprovals(teamId)
  const { data } = useQuery({
    queryKey,
    queryFn: () => api.localShareApprovals(teamId),
    enabled: Boolean(teamId),
    refetchInterval: poll && SHARE_APPROVAL_POLL_MS,
    refetchIntervalInBackground: poll,
  })

  async function decide(
    approval: LocalShareApproval,
    approve: boolean,
    trust?: ShareTrustDuration,
  ) {
    await api.localShareDecide(approval.id, approve, trust)
    void client.invalidateQueries({ queryKey })
  }

  return { approvals: data ?? NONE, decide }
}
