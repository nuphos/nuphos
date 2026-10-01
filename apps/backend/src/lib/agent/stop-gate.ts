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
// Two tiers: deterministic rules here (plan lifecycle, silent turn end), then
// an LLM judge (stop-gate-judge.ts) for intent-completion and
// asked-answerable checks. Both are fail-open: any error during evaluation
// lets the turn complete normally. A per-turn fuse
// (MAX_STOP_GATE_CONTINUATIONS) stops a broken rule from looping the agent —
// a runaway forced continuation is strictly worse than a premature stop.
import {
  MAX_STOP_GATE_CONTINUATIONS,
  planNudge,
  planStatusLine,
  puntNudge,
  silentEndNudge,
} from './stop-gate-nudges'

import type { Plan } from './plans'
import type { ToolResultError } from './tool-result-errors'

export { MAX_STOP_GATE_CONTINUATIONS, planProgress } from './stop-gate-nudges'
export {
  canonicalToolInputKey,
  detectRunawayToolFailures,
  latestRealUserText,
  RUNAWAY_FAILURE_THRESHOLD,
  runawayWrapUpText,
} from './stop-gate-runaway'
export type { RunawayDetection } from './stop-gate-runaway'

export type StopGateReason =
  | 'plan-execution-incomplete'
  | 'silent-turn-end'
  // LLM-judged (see stop-gate-judge.ts):
  | 'user-intent-unmet'
  | 'asked-answerable-question'

export type StopGateVerdict =
  { behavior: 'allow' } | { behavior: 'continue'; reason: StopGateReason; nudge: string }

export type StopGateInput = {
  /** Text parts of the final assistant message of the turn. */
  finalProse: string
  /** Non-terminal plans linked to this conversation (proposed/approved/executing). */
  activePlans: Plan[]
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
 * Compact per-turn system block describing every non-terminal plan attached
 * to this conversation. Injected every turn so the model never has to
 * remember (or re-fetch the plan) whether it left a plan hanging — the
 * current lifecycle truth is always in context. Returns null when there is
 * nothing to show.
 */
export function renderActivePlanStatusBlock(plans: Plan[]): string | null {
  if (plans.length === 0) return null
  const lines = plans.map((plan) => {
    const base = `- ${planStatusLine(plan)}`
    const stepLines = (plan.steps ?? [])
      .map((step, idx) => {
        const cmds = (step.jobs ?? []).flatMap((job) => job.commands ?? [])

        if (cmds.length === 0) return `  ${String(idx + 1)}. ${step.title}`
        const done = cmds.filter((c) => c.status === 'done').length
        const failed = cmds.filter((c) => c.status === 'failed').length
        const running = cmds.filter((c) => c.status === 'running').length
        const failedSuffix = failed > 0 ? `, ${String(failed)} failed` : ''
        // Without this a command left in `running` is indistinguishable from
        // `pending`, so the model can never notice it should be reconciled.
        const runningSuffix = running > 0 ? `, ${String(running)} still marked running` : ''

        return `  ${String(idx + 1)}. ${step.title} (${String(done)}/${String(cmds.length)} commands done${failedSuffix}${runningSuffix})`
      })
      .join('\n')

    return stepLines ? `${base}\n${stepLines}` : base
  })

  return [
    '## Current plan state (live)',
    '',
    'Non-terminal plans attached to this conversation, as currently stored. This is the source of truth — do not rely on memory of earlier turns.',
    '',
    ...lines,
    '',
    'Before ending your turn: an `executing` plan must either progress, be completed, or have its status updated to reflect reality (PATCH /agent/plans/{planId} — load the `plan` skill for the exact calls). Only the command you are working on right now may be `running`; if a command above is still marked running and you have moved on, patch it to `done` or `failed`. An `approved` plan means the user already said go — execute it. A `proposed` plan is correctly waiting for the user to approve or reject; do not start executing it.',
  ].join('\n')
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

  // Rule 1 — plan execution left hanging. `approved` means the user already
  // said go; `executing` with unfinished commands means work is mid-flight.
  // `executing` with every command finished is still a gate: the status
  // itself must be reconciled to completed/failed before the turn ends.
  // `proposed` is the one non-terminal status where stopping is CORRECT
  // (awaiting human approval), so it never gates.
  const gatedPlans = input.activePlans.filter(
    (plan) => plan.status === 'approved' || plan.status === 'executing',
  )

  if (gatedPlans.length > 0) {
    return {
      behavior: 'continue',
      reason: 'plan-execution-incomplete',
      nudge: planNudge(gatedPlans, input.priorContinuations),
    }
  }

  // Rule 2 — silent turn end: no prose in the final assistant message.
  if (input.finalProse.length === 0) {
    return {
      behavior: 'continue',
      reason: 'silent-turn-end',
      nudge: silentEndNudge(input.toolResultErrors, input.priorContinuations),
    }
  }

  return { behavior: 'allow' }
}
