import { useEffect, useRef } from 'react'

import { api } from '../../api'
import { memberDisplayName, useTeamMembers } from '../../lib/bindingAccess'

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
  const members = useTeamMembers(teamId)
  const sent = useRef(new Set<string>())
  const waited = useRef(new Set<string>())

  useEffect(() => {
    for (const approval of approvals) {
      if (sent.current.has(approval.id)) continue
      // The first poll can land before the members do: give the name one more poll.
      if (members.length === 0 && !waited.current.has(approval.id)) {
        waited.current.add(approval.id)
        continue
      }
      sent.current.add(approval.id)
      const member = members.find((entry) => entry.id === approval.actorId)
      const { title, body } = shareApprovalNotice(approval, member && memberDisplayName(member))

      void api.localShareNotify(approval.id, teamId, title, body).catch(() => {
        // Best effort: the Inbox still lists it.
      })
    }
  }, [approvals, members, teamId])
}
