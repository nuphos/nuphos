import clsx from 'clsx'

import { t } from '../../../i18n'

import type { PlanLifecycleStatus } from '../../../api'

// Lifecycle status → human label + chip styling. Single source for every
// surface that shows a plan's status (inline card, side pane, library list).
const PLAN_STATUS_LABEL: Record<PlanLifecycleStatus, string> = {
  proposed: t('Proposed'),
  approved: t('Approved'),
  rejected: t('Rejected'),
  executing: t('Executing'),
  completed: t('Completed'),
  failed: t('Failed'),
  cancelled: t('Unplanned'),
}

const PLAN_STATUS_TONE: Record<PlanLifecycleStatus, string> = {
  proposed: 'text-primary bg-state-selected border-action-primary/30',
  approved: 'text-primary bg-state-selected border-action-primary/30',
  executing: 'text-primary bg-state-selected border-action-primary/40',
  completed: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  failed: 'text-error bg-error/10 border-error/30',
  rejected: 'text-tertiary bg-state-selected border-line-control',
  cancelled: 'text-tertiary bg-state-selected border-line-control',
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
