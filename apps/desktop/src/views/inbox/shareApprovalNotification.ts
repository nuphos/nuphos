import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { api } from '../../api'
import { memberDisplayName } from '../../lib/bindingAccess'
import { teamMembersQuery } from '../../lib/query/team'

import { shareApprovalNotice } from './shareApprovalNotice'

import type { LocalShareApproval } from '../../api/device-types'

/**
 * Tells the owner, through a system notification, about each new request to use their
 * computer: the Inbox badge alone goes unseen while the window is in the background.
 */
export function useShareApprovalNotifications(
  teamId: string,
  approvals: readonly LocalShareApproval[],
): void {
  const roster = useQuery({ ...teamMembersQuery(teamId), enabled: Boolean(teamId) })
  const members = roster.data
  const sent = useRef(new Set<string>())

  useEffect(() => {
    // Until the members' read answers or fails, a notice would lack the name.
    if (!roster.isFetched) return
    for (const approval of approvals) {
      if (sent.current.has(approval.id)) continue
      sent.current.add(approval.id)
      const member = members?.find((entry) => entry.id === approval.actorId)
      const { title, body } = shareApprovalNotice(approval, member && memberDisplayName(member))

      void api.localShareNotify(approval.id, teamId, title, body).catch(() => {
        // Best effort: the Inbox still lists it.
      })
    }
  }, [approvals, members, roster.isFetched, teamId])
}
