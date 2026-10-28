import { BOOKKEEPING_TOOL_NAMES } from './toolRuns.ts'

import type { Part } from './parts.ts'

// Codex-style turn folding: a turn qualifies when its last meaningful part is
// answer text and every tool before it ran to completion — nothing pending
// approval, still running, or cut off. A call that ran and failed still counts
// as finished: agents probe as they go, so a grep with no match must not keep
// the whole turn expanded; the failed row keeps its error styling inside the
// fold. HITL turns whose approvals were answered end in terminal tool states,
// so they fold too; their cards stay inside the fold at their original
// position. Returns the index of that final text part (the fold boundary), or
// -1 when the turn must stay fully expanded.
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
    if (!p.state.startsWith('output-')) return -1
    if (!BOOKKEEPING_TOOL_NAMES.has(p.toolName)) hasProcess = true
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

// An approval the user can still answer keeps an interrupted turn expanded.
function awaitsApproval(parts: Part[], to: number): boolean {
  return parts.slice(0, to).some((p) => p.type === 'tool' && p.state === 'approval-requested')
}

// Where this turn's fold starts, or -1 when the turn stays fully expanded. A
// turn still streaming, or one the user steered mid-flight, shows its work as it
// happens; a finished turn folds whether it ended in an answer or was cut short.
// endedWithoutAnswer: the user stopped the turn, or it finished with no reply text.
export function turnFoldSplitIndex(
  parts: Part[],
  { streaming, endedWithoutAnswer }: { streaming: boolean; endedWithoutAnswer?: boolean },
): number {
  if (parts.some((p) => p.type === 'data-steering')) return 0
  if (streaming) return -1
  if (endedWithoutAnswer === true || parts.some((p) => p.type === 'turn-interrupted')) {
    const split = interruptedTurnSplitIndex(parts)

    return awaitsApproval(parts, split) ? -1 : split
  }

  return collapsedTurnSplitIndex(parts)
}
