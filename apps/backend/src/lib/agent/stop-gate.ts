// Stop gate: end-of-turn completion checks (ZEA harness P0).
//
// When the model ends a turn cleanly (Bedrock end_turn → finishReason 'stop'),
// the agent-turn loop in routes/agent.ts evaluates this gate before letting
// the turn finish. A veto starts another streamText round in the SAME request:
// the previous round's messages plus a synthetic user nudge go back to the
// model, and the new round's UI frames are stitched into the same response
// stream. Entirely server-side — every channel (app, Slack, Discord, MCP,
// trigger) gets the same behaviour, no client cooperation involved.
//
// Two tiers: a deterministic rule here (silent turn end), then
// an LLM judge (stop-gate-judge.ts) for intent-completion and
// asked-answerable checks. Both are fail-open: any error during evaluation
// lets the turn complete normally. A per-turn fuse
// (MAX_STOP_GATE_CONTINUATIONS) stops a broken rule from looping the agent —
// a runaway forced continuation is strictly worse than a premature stop.
import { MAX_STOP_GATE_CONTINUATIONS, puntNudge, silentEndNudge } from './stop-gate-nudges'

import type { ToolResultError } from './tool-result-errors'

export { MAX_STOP_GATE_CONTINUATIONS } from './stop-gate-nudges'
export {
  canonicalToolInputKey,
  detectRunawayToolFailures,
  latestRealUserText,
  RUNAWAY_FAILURE_THRESHOLD,
  runawayWrapUpText,
} from './stop-gate-runaway'
export type { RunawayDetection } from './stop-gate-runaway'

export type StopGateReason =
  | 'silent-turn-end'
  // LLM-judged (see stop-gate-judge.ts):
  | 'user-intent-unmet'
  | 'asked-answerable-question'

export type StopGateVerdict =
  { behavior: 'allow' } | { behavior: 'continue'; reason: StopGateReason; nudge: string }

export type StopGateInput = {
  /** Text parts of the final assistant message of the turn. */
  finalProse: string
  /** Tool-result errors observed anywhere in the turn (already deduped). */
  toolResultErrors: ToolResultError[]
  /** Stop-gate continuations already forced for this user turn. */
  priorContinuations: number
  /** A structured request_user_decision tool call established that progress
   *  requires a real user-only choice. Prose alone never sets this bit. */
  awaitingUserDecision?: boolean
}

/**
 * Extract the prose the user actually sees at the end of the turn: the text
 * parts of the LAST assistant message. Reasoning and tool-call parts do not
 * count — a turn that ends on those is silent from the user's perspective.
 */
export function finalAssistantProse(responseMessages: unknown): string {
  if (!Array.isArray(responseMessages)) return ''
  for (let i = responseMessages.length - 1; i >= 0; i--) {
    const msg = responseMessages[i] as { role?: unknown; content?: unknown }

    if (msg?.role !== 'assistant') continue
    if (typeof msg.content === 'string') return msg.content.trim()
    if (!Array.isArray(msg.content)) return ''

    return msg.content
      .filter(
        (part): part is { type: string; text: string } =>
          (part as { type?: unknown })?.type === 'text' &&
          typeof (part as { text?: unknown })?.text === 'string',
      )
      .map((part) => part.text)
      .join('\n')
      .trim()
  }

  return ''
}

/**
 * Maps a stop-gate judge result (stop-gate-judge.ts) onto a verdict. Null in
 * → null out (judge failed open); a passing judgement also returns null so
 * the caller keeps its deterministic verdict. Pure and unit-testable.
 */
export function judgeResultToVerdict(
  result: { punt: boolean; reason: string } | null,
  priorContinuations: number,
): StopGateVerdict | null {
  if (!result) return null
  if (priorContinuations >= MAX_STOP_GATE_CONTINUATIONS) return null
  if (result.punt) {
    return {
      behavior: 'continue',
      reason: 'asked-answerable-question',
      nudge: puntNudge(result.reason, priorContinuations),
    }
  }

  return null
}

/**
 * Decide whether a cleanly-stopped turn is allowed to end. Pure function —
 * all state is passed in, so the rules are unit-testable and the caller owns
 * persistence/telemetry.
 */
export function evaluateStopGate(input: StopGateInput): StopGateVerdict {
  // Fuse first: past the ceiling, always allow. Prevents nudge loops when the
  // model cannot (or will not) satisfy a rule — e.g. blocked on a credential
  // only the user can provide.
  if (input.priorContinuations >= MAX_STOP_GATE_CONTINUATIONS) {
    return { behavior: 'allow' }
  }

  // A real user decision is an intentional terminal state, not a punt. The
  // dedicated tool is the proof: merely ending prose with a question does not
  // bypass the gate. Still require visible prose so a tool-only turn cannot
  // leave the user staring at silence.
  if (input.awaitingUserDecision && input.finalProse.length > 0) {
    return { behavior: 'allow' }
  }

  // Silent turn end: no prose in the final assistant message.
  if (input.finalProse.length === 0) {
    return {
      behavior: 'continue',
      reason: 'silent-turn-end',
      nudge: silentEndNudge(input.toolResultErrors, input.priorContinuations),
    }
  }

  return { behavior: 'allow' }
}
