import clsx from 'clsx'

import type { PlanLifecycleStatus } from '../../../api'

// Lifecycle status → human label + chip styling. Single source for every
// surface that shows a plan's status (inline card, side pane, library list).
const PLAN_STATUS_LABEL: Record<PlanLifecycleStatus, string> = {
  proposed: 'Proposed',
  approved: 'Approved',
  rejected: 'Rejected',
  executing: 'Executing',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Unplanned',
}

const PLAN_STATUS_TONE: Record<PlanLifecycleStatus, string> = {
  proposed: 'text-zViolet-accent bg-zViolet-500/10 border-zViolet-500/30',
  approved: 'text-zViolet-accent bg-zViolet-500/10 border-zViolet-500/30',
  executing: 'text-zViolet-accent bg-zViolet-500/15 border-zViolet-500/40',
  completed: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  failed: 'text-error bg-error/10 border-error/30',
  rejected: 'text-tertiary bg-zGray-800/50 border-zGray-700',
  cancelled: 'text-tertiary bg-zGray-800/50 border-zGray-700',
}

export function PlanStatusBadge({ status }: { status: PlanLifecycleStatus }) {
  return (
    <span
      className={clsx(
        'inline-flex flex-shrink-0 items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider',
        PLAN_STATUS_TONE[status],
      )}
    >
      {PLAN_STATUS_LABEL[status]}
    </span>
  )
}
