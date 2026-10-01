import type { Decision } from './usePlanDecision'
import type { PlanLifecycleStatus } from '../../../api'

export function initiallyFolded(foldable: boolean): boolean {
  return foldable
}

export function planCardRegions({
  folded,
  decision,
  canApprove,
  canRetry,
  status,
}: {
  folded: boolean
  decision: Decision
  canApprove: boolean
  canRetry: boolean
  status?: PlanLifecycleStatus
}) {
  const showRetry = canRetry && status === 'failed' && decision === 'pending'
  const showApproveBar = canApprove && decision === 'pending'

  return {
    bodyOpen: !folded,
    showRetry,
    showApproveBar,
    // Carries the approve/request-changes box, the retry button, or the
    // terminal status line. Independent of `folded`.
    showActionBar: decision !== 'pending' || showRetry || showApproveBar,
  }
}
