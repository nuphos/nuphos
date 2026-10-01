import { Ban, Link2, MessageSquare } from 'lucide-react'
import { useCallback } from 'react'

import { api } from '../../api'
import { emitPlanUpdated } from '../../components/agent/planUpdates'
import { toast } from '../../components/ui/toast'

import { CANCELLABLE_STATUSES, proposalUrl } from './planRows'

import type { LoadState, Row } from './planRows'
import type { Plan } from '../../api'
import type { ContextMenuItem } from '../../components/ContextMenu'

type ActionsArgs = {
  teamId: string
  reload: () => Promise<void>
  setState: React.Dispatch<React.SetStateAction<LoadState>>
  setFetchedPlan: React.Dispatch<React.SetStateAction<Plan | null>>
  onOpenInChat?: (planId: string) => void
}

export function usePlanRowActions({
  teamId,
  reload,
  setState,
  setFetchedPlan,
  onOpenInChat,
}: ActionsArgs) {
  // Optimistically flip the row to `cancelled` so the list updates instantly,
  // then PATCH. On failure, reload to resync with the server.
  const markUnplanned = useCallback(
    async (plan: Plan) => {
      setState((prev) => {
        if (prev.kind !== 'ready') return prev

        return {
          ...prev,
          plans: prev.plans.map((p) =>
            p.id === plan.id ? { ...p, status: 'cancelled' as const } : p,
          ),
        }
      })
      try {
        const updated = await api.agentUpdatePlan(plan.id, { status: 'cancelled' }, teamId)

        // Re-apply the authoritative row from the PATCH response. The list
        // polls frequently; a poll that read stale (pre-commit) data could
        // have clobbered the optimistic value, so stamp the confirmed status.
        setState((prev) => {
          if (prev.kind !== 'ready') return prev

          return {
            ...prev,
            plans: prev.plans.map((p) => (p.id === updated.id ? updated : p)),
          }
        })
      } catch (err) {
        console.warn('[plan] failed to mark unplanned', err)
        setState({ kind: 'loading' })
        void reload()
      }
    },
    [teamId, reload, setState],
  )

  const approvePlan = useCallback(
    async (plan: Plan): Promise<Plan> => {
      const previousApprovalCount = plan.approvals.length

      try {
        // Keep using the legacy-compatible status PATCH so old desktop builds
        // and the new explicit approval endpoint share exactly one backend
        // quorum path. The response remains proposed until the gate is met.
        const updated = await api.agentUpdatePlan(plan.id, { status: 'approved' }, teamId)

        setState((prev) => {
          if (prev.kind !== 'ready') return prev

          return {
            ...prev,
            plans: prev.plans.map((candidate) =>
              candidate.id === updated.id ? updated : candidate,
            ),
          }
        })
        setFetchedPlan((current) => (current?.id === updated.id ? updated : current))
        emitPlanUpdated(updated)

        if (updated.status === 'approved') {
          toast.success('Plan approved', 'The approval gate is complete.')
        } else if (updated.approvals.length === previousApprovalCount) {
          toast.success('Approval already recorded', 'Your vote is already included in this plan.')
        } else {
          const remaining = Math.max(
            0,
            Number(
              updated.approvalProgress.requesterApprovalRequired &&
                !updated.approvalProgress.requesterApproved,
            ) +
              updated.approvalProgress.minimumOtherApprovals -
              updated.approvalProgress.otherApprovals,
          )

          toast.success(
            'Approval recorded',
            `${String(remaining)} required approval${remaining === 1 ? '' : 's'} remaining.`,
          )
        }

        return updated
      } catch (err) {
        toast.apiError('Could not approve plan', err, {
          fallback: 'The plan was not approved. Please try again.',
        })
        throw err
      }
    },
    [teamId, setState, setFetchedPlan],
  )

  const copyProposalLink = useCallback(
    (proposalId: string) => {
      const url = proposalUrl(teamId, proposalId)

      navigator.clipboard.writeText(url).then(
        () => toast.success('Link copied', 'Send it to a team administrator to approve.'),
        () => toast.error('Could not copy link', url),
      )
    },
    [teamId],
  )

  const buildMenu = useCallback(
    (row: Row): ContextMenuItem[] => {
      if (row.kind === 'permission') {
        // A permission request has no chat/unplan actions — just the shareable
        // link the requester hands to an administrator.
        return [
          {
            key: 'copy-link',
            label: 'Copy link',
            icon: Link2,
            onSelect: () => copyProposalLink(row.id),
          },
        ]
      }
      const plan = row.plan
      const items: ContextMenuItem[] = [
        {
          key: 'open-in-chat',
          // A proposed plan can be pulled back into chat and run (any team
          // member); terminal plans are just opened for review.
          label: plan.status === 'proposed' ? 'Continue in chat' : 'Open in chat',
          icon: MessageSquare,
          onSelect: () => onOpenInChat?.(plan.id),
        },
      ]

      // Only offer "Mark as unplanned" while the plan is still cancellable —
      // terminal plans (completed / failed / rejected / cancelled) don't get it.
      if (CANCELLABLE_STATUSES.has(plan.status)) {
        items.push(
          { key: 'sep', separator: true },
          {
            key: 'unplan',
            label: 'Mark as unplanned',
            icon: Ban,
            destructive: true,
            confirm: `Mark plan #${String(plan.number)} as unplanned?`,
            onSelect: () => void markUnplanned(plan),
          },
        )
      }

      return items
    },
    [markUnplanned, onOpenInChat, copyProposalLink],
  )

  return { approvePlan, copyProposalLink, buildMenu }
}
