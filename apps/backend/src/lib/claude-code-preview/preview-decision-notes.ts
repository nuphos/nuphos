// Decision routes (permission-grant approve/reject, Auto Mode rule
// activate/remove) call this so a Claude Code turn blocked on that entity
// resumes even when the desktop never POSTs a continuation.
// Never fails the route: a missing wait just means no turn was parked on it.
import { resolvePreviewDecisionByRef } from './decision-waiter'

import type { PreviewWaitKind } from './decision-waiter'

export async function notePreviewDecision(
  kind: Extract<PreviewWaitKind, 'permission-grant' | 'authorization-rule'>,
  ref: string,
  decision: 'approved' | 'rejected',
  decidedByUserId: string,
): Promise<void> {
  try {
    await resolvePreviewDecisionByRef({ kind, ref, payload: { decision, decidedByUserId } })
  } catch {
    // The wait store is best-effort from a REST route's point of view.
  }
}
