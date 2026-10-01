import type { Part } from './parts.ts'

// Codex-style turn folding: a turn qualifies when its last meaningful part is
// answer text and every tool before it ran to completion — nothing pending
// approval, still running, or cut off. HITL turns whose approvals were
// answered end in terminal tool states, so they fold too; their cards stay
// inside the fold at their original position. Returns the index of that
// final text part (the fold boundary), or -1 when the turn must stay fully
// expanded.
export function collapsedTurnSplitIndex(parts: Part[]): number {
  let finalTextIndex = -1

  for (let i = parts.length - 1; i >= 0 && finalTextIndex === -1; i--) {
    const p = parts[i]

    if (p.type === 'text' && p.text.trim()) finalTextIndex = i
    else if (p.type === 'tool') return -1
  }
  if (finalTextIndex <= 0) return -1
  let hasProcess = false

  for (let i = 0; i < finalTextIndex; i++) {
    const p = parts[i]

    if (p.type !== 'tool') {
      if ((p.type === 'text' || p.type === 'reasoning') && p.text.trim()) hasProcess = true
      continue
    }
    if (p.state !== 'output-available' && p.state !== 'output-error') return -1
    if (p.toolName !== 'skill' && p.toolName !== 'plan_update' && p.toolName !== 'plan_get') {
      hasProcess = true
    }
  }

  return hasProcess ? finalTextIndex : -1
}

// Fold boundary for a turn the backend cut short: the outcome — a trailing
// answer text and the interruption notice — stays visible, while everything the
// turn did before it folds away.
export function interruptedTurnSplitIndex(parts: Part[]): number {
  let split = parts.length

  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]

    if (p.type !== 'turn-interrupted' && p.type !== 'text' && p.type !== 'step-start') break
    split = i
  }

  return split
}

// An approval the user can still answer keeps its buttons, so it must not end up
// behind the fold.
function awaitsApproval(parts: Part[], to: number): boolean {
  for (let i = 0; i < to; i++) {
    const p = parts[i]

    if (p.type === 'tool' && p.state === 'approval-requested') return true
  }

  return false
}

// Where this turn's fold starts, or -1 when the turn stays fully expanded. A
// turn still streaming, or one the user steered mid-flight, shows its work as it
// happens; a finished turn folds whether it ended in an answer or was cut short.
export function turnFoldSplitIndex(
  parts: Part[],
  { streaming, stoppedByUser }: { streaming: boolean; stoppedByUser?: boolean },
): number {
  if (parts.some((p) => p.type === 'data-steering')) return 0
  if (streaming) return -1
  if (stoppedByUser === true || parts.some((p) => p.type === 'turn-interrupted')) {
    const split = interruptedTurnSplitIndex(parts)

    return awaitsApproval(parts, split) ? -1 : split
  }

  return collapsedTurnSplitIndex(parts)
}
