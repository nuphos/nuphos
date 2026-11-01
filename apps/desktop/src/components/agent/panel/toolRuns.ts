import { isPlanProposalToolName } from '../planReference.ts'

import { parseChoiceRequest, parseConnectRequest, parseSecretRequest } from './connectCardModel.ts'
import { isHiddenMemoryIngestPart } from './parts.ts'
import { isThreadBadgePart } from './threadBadges.ts'
import { INTERRUPTED_TOOL_MESSAGE, incompleteToolErrorText } from './toolInterruption.ts'
import { isTriggerCardPart } from './triggerCards.ts'

import type { Part, ToolPart } from './parts.ts'

export type PartSegment =
  | { kind: 'part'; index: number }
  // Plain tool calls and any thinking between them. Even a single call is a
  // run, so the slot exists from the first call and later calls replace its
  // content in place instead of folding a finished call away. Narration
  // between calls ends the run so it stays where it happened in the turn.
  | { kind: 'toolRun'; indices: number[] }

// Tool calls that render as their own card (chart, artifact, plan, permission grant)
// carry content the user came for, so they never hide inside a run. So does a
// user decision: a Connect card for an integration, a question card otherwise.
const CARD_TOOL_NAMES = new Set([
  'render_chart',
  'render_artifact',
  'plan',
  'propose_permission_grant',
])

export function isDecisionCardPart(part: Part): boolean {
  return (
    part.type === 'tool' &&
    part.toolName === 'request_user_decision' &&
    (parseConnectRequest(part.input) ??
      parseSecretRequest(part.input) ??
      parseChoiceRequest(part.input)) !== null
  )
}

// Agent bookkeeping that never renders as a tool row.
/** The call a run opens for: the newest one waiting for approval, wherever it
 * sits in the run. A failed call does not open it. */
export function pendingApproval(parts: ToolPart[]): ToolPart | undefined {
  return parts.findLast((part) => part.state === 'approval-requested')
}

export const BOOKKEEPING_TOOL_NAMES = new Set(['skill', 'plan_update', 'plan_get'])

export function isPlainToolPart(part: Part): part is ToolPart {
  if (part.type !== 'tool') return false
  if (CARD_TOOL_NAMES.has(part.toolName) || isPlanProposalToolName(part.toolName)) return false
  if (isDecisionCardPart(part)) return false
  if (isThreadBadgePart(part) || isTriggerCardPart(part)) return false

  return !BOOKKEEPING_TOOL_NAMES.has(part.toolName)
}

// Parts the message renders as nothing — they neither join a run nor split it.
export function isInvisiblePart(part: Part): boolean {
  if (part.type === 'step-start') return true
  if (part.type === 'text' || part.type === 'reasoning') return part.text.trim().length === 0
  if (part.type === 'memory-ingest') return isHiddenMemoryIngestPart(part)
  if (part.type !== 'tool') return false
  if (part.toolName === 'skill') return true
  if (part.toolName === 'plan_update' || part.toolName === 'plan_get') {
    return part.state === 'output-available' || part.state === 'output-error'
  }

  return false
}

function plainToolFollows(parts: readonly Part[], from: number, to: number): boolean {
  for (let index = from; index < to; index += 1) {
    const part = parts[index]

    if (isInvisiblePart(part) || part.type === 'reasoning') continue

    return isPlainToolPart(part)
  }

  return false
}

export function finalizeToolPartForDisplay(part: ToolPart): ToolPart {
  if (part.state !== 'input-streaming' && part.state !== 'input-available') return part

  return {
    ...part,
    state: 'output-error',
    errorText: incompleteToolErrorText(part, INTERRUPTED_TOOL_MESSAGE),
  }
}

// A stopped turn has nothing in flight: show its unanswered calls as
// interrupted everywhere — single rows, grouped runs and the fold — instead of
// leaving them loading.
export function turnDisplayParts(parts: Part[], streaming: boolean): Part[] {
  if (streaming) return parts

  return parts.map((part) => (part.type === 'tool' ? finalizeToolPartForDisplay(part) : part))
}

export function segmentParts(parts: readonly Part[], from: number, to: number): PartSegment[] {
  const segments: PartSegment[] = []
  let run: number[] = []
  const flushRun = () => {
    if (run.length > 0) segments.push({ kind: 'toolRun', indices: run })
    run = []
  }

  for (let index = from; index < to; index += 1) {
    const part = parts[index]

    if (isInvisiblePart(part)) {
      segments.push({ kind: 'part', index })
      continue
    }
    if (isPlainToolPart(part)) {
      run.push(index)
      continue
    }
    if (part.type === 'reasoning' && run.length > 0 && plainToolFollows(parts, index + 1, to)) {
      run.push(index)
      continue
    }
    flushRun()
    segments.push({ kind: 'part', index })
  }
  flushRun()

  return segments
}

/** Plan, decision and artifact cards: lifted out of a folded turn so they sit under the answer. */
export function isLiftedCardPart(part: Part): part is ToolPart {
  if (part.type !== 'tool' || part.state === 'output-error') return false

  return (
    part.toolName === 'plan' ||
    part.toolName === 'render_artifact' ||
    isPlanProposalToolName(part.toolName) ||
    isDecisionCardPart(part)
  )
}

// A folded turn lifts its plan, decision and trigger cards and thread badges out
// from behind the "Worked for" header so they sit under the answer; the fold
// itself only renders when other work remains.
export function foldedTurnLayout(
  parts: readonly Part[],
  from: number,
  to: number,
): { planIndices: number[]; foldHasWork: boolean } {
  const planIndices: number[] = []
  let foldHasWork = false

  for (let index = from; index < to; index += 1) {
    const part = parts[index]

    if (isLiftedCardPart(part) || isThreadBadgePart(part) || isTriggerCardPart(part)) {
      planIndices.push(index)
    } else if (!isInvisiblePart(part)) foldHasWork = true
  }

  return { planIndices, foldHasWork }
}
