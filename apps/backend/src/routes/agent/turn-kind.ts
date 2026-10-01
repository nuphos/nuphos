import type { UIMessage } from 'ai'

/** Set by the surface that generated the turn, never inferred from its text. */
export type TurnKind = 'plan-approval'

export function isPlanApprovalTurn(message: UIMessage | undefined): boolean {
  return (message?.metadata as { turnKind?: unknown } | undefined)?.turnKind === 'plan-approval'
}
