import { isPlanProposalToolName } from '../planReference.ts'

import { isHiddenMemoryIngestPart } from './parts.ts'

import type { Part, ToolPart } from './parts.ts'

export type PartSegment =
  | { kind: 'part'; index: number }
  // Plain tool calls and any thinking between them. Even a single call is a
  // run, so the slot exists from the first call and later calls replace its
  // content in place instead of folding a finished call away. Narration
  // between calls ends the run so it stays where it happened in the turn.
  | { kind: 'toolRun'; indices: number[] }

// Tool calls that render as their own card (chart, plan, permission grant)
// carry content the user came for, so they never hide inside a run.
const CARD_TOOL_NAMES = new Set(['render_chart', 'plan', 'propose_permission_grant'])
const BOOKKEEPING_TOOL_NAMES = new Set(['skill', 'plan_update', 'plan_get'])

export function isPlainToolPart(part: Part): part is ToolPart {
  if (part.type !== 'tool') return false
  if (CARD_TOOL_NAMES.has(part.toolName) || isPlanProposalToolName(part.toolName)) return false

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

export function isPlanCardPart(part: Part): part is ToolPart {
  if (part.type !== 'tool' || part.state === 'output-error') return false

  return part.toolName === 'plan' || isPlanProposalToolName(part.toolName)
}

// A folded turn lifts its plan cards out from behind the "Worked for" header so
// they sit under the answer; the fold itself only renders when other work remains.
export function foldedTurnLayout(
  parts: readonly Part[],
  from: number,
  to: number,
): { planIndices: number[]; foldHasWork: boolean } {
  const planIndices: number[] = []
  let foldHasWork = false

  for (let index = from; index < to; index += 1) {
    const part = parts[index]

    if (isPlanCardPart(part)) planIndices.push(index)
    else if (!isInvisiblePart(part)) foldHasWork = true
  }

  return { planIndices, foldHasWork }
}
