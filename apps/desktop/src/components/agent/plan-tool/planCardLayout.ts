import type { Decision } from './usePlanDecision'

export function initiallyFolded(foldable: boolean): boolean {
  return foldable
}

export function planCardRegions({
  folded,
  decision,
  canApprove,
}: {
  folded: boolean
  decision: Decision
  canApprove: boolean
}) {
  const showApproveBar = canApprove && decision === 'pending'

  return {
    bodyOpen: !folded,
    showApproveBar,
    // Carries the approve/request-changes box or the terminal status line.
    // Independent of `folded`.
    showActionBar: decision !== 'pending' || showApproveBar,
  }
}
