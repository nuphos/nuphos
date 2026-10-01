import { ATLAS_WEB_BASE_URL } from '../../lib/webBaseUrl'

import type { Plan, PlanLifecycleStatus } from '../../api'
import type { PermissionGrantProposalView } from '../../types'

// A row in the Plans library is either a real plan or a permission-grant
// request (surfaced here so admins have one team-wide review queue and the
// requester can copy a shareable URL). They never collide on id: plan ids are
// numeric strings, proposal ids are hex ObjectIds.
export type Row =
  | { kind: 'plan'; id: string; createdAt: string; createdBy: string; plan: Plan }
  | {
      kind: 'permission'
      id: string
      createdAt: string
      createdBy: string
      proposal: PermissionGrantProposalView
    }

export type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; plans: Plan[]; nextCursor: string | null; hasMore: boolean }
  | { kind: 'error'; message: string }

export const PAGE_SIZE = 50

// Statuses that can still be abandoned ("mark as unplanned"). Terminal states
// (completed / failed / rejected / cancelled) can't.
export const CANCELLABLE_STATUSES: ReadonlySet<PlanLifecycleStatus> = new Set([
  'proposed',
  'approved',
  'executing',
])

// "Dismissed" plans — a declined proposal (rejected) or an abandoned plan
// (cancelled). Hidden from the default library list so they don't clutter it;
// still reachable via the "Show dismissed" toggle and by deep link / search.
export const DISMISSED_STATUSES: ReadonlySet<PlanLifecycleStatus> = new Set([
  'rejected',
  'cancelled',
])

// Map a proposal's lifecycle onto the plan badge vocabulary so the Status
// column reads consistently across both row kinds.
export function proposalPlanStatus(
  status: PermissionGrantProposalView['status'],
): PlanLifecycleStatus {
  return status === 'executed' ? 'completed' : status
}

export function proposalUrl(teamId: string, proposalId: string): string {
  return `${ATLAS_WEB_BASE_URL}/teams/${teamId}/plans/${proposalId}`
}

// A row is "dismissed" (hidden by default) when a plan was rejected/cancelled
// or a permission request was rejected.
export function isRowDismissed(row: Row): boolean {
  return row.kind === 'plan'
    ? DISMISSED_STATUSES.has(row.plan.status)
    : proposalPlanStatus(row.proposal.status) === 'rejected'
}
