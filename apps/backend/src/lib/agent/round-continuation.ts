// What the agent-turn loop does after a round finishes.
//
// Two independent reasons can send the model back in: the stop gate vetoes an
// end-of-turn that left work undone (stop-gate.ts), and a budget pause cut the
// round off mid-work — the output-token cap truncated a message. Neither is the
// model saying "done". (There is no tool-call step cap; the loop runs until the
// model stops calling tools.)
//
// Continuing is server-side only. Interactive clients do NOT re-issue a paused
// turn — they show the reason the backend gave and stop — so this is the only
// thing standing between a truncated message and a headless channel (Slack,
// Lark, Discord, MCP, triggers) delivering half an answer.
//
// Only budget pauses qualify. A content filter or an unrecognized finish
// reason would reproduce on replay, so those still end the turn.
import { MAX_STOP_GATE_CONTINUATIONS } from './stop-gate'

/**
 * Max output-budget continuations per request. Bounds a model that truncates
 * at the output cap every round instead of finishing its message.
 */
export const MAX_BUDGET_CONTINUATIONS = 8

/**
 * Max rounds a turn may be extended because the user said something new while
 * it was running. Human-paced, so this is a runaway fuse rather than a real
 * limit; past it the queued message starts a fresh turn instead.
 *
 * Counted separately from the budget and stop-gate fuses on purpose: a user
 * steering the agent must not spend the allowance that exists to finish
 * truncated work, and vice versa.
 */
export const MAX_STEER_CONTINUATIONS = 8

export type BudgetPauseKind = 'output-budget'

/**
 * 'tool-calls' is deliberately absent: without a step cap the only thing that
 * ends a round mid-tool-call is the Auto Mode approval gate, and that is a
 * clean pause the user has to answer — continuing it would talk over the
 * approve/deny they are looking at.
 */
export function budgetPauseKind(finishReason: string | undefined): BudgetPauseKind | null {
  if (finishReason === 'length') return 'output-budget'

  return null
}

/**
 * How a turn that still ended paused should be explained to a headless
 * channel's user. Budget pauses reaching here means the continuation ceiling
 * was spent — the work is real but unfinished. Anything else (the stall
 * watchdog, a content filter) means the turn stopped without that guarantee.
 * Callers word it in their own channel's voice.
 */
export type PausedTurnKind = 'budget-exhausted' | 'stalled'

export function pausedTurnKind(pauseReason: string | undefined): PausedTurnKind {
  // A headless turn that hit its wall-clock ceiling is the same shape as a
  // spent budget — real work, cut short — not a stall. Wording it as "stalled"
  // would tell the user nothing went wrong when 45 minutes of work did.
  return pauseReason === 'output-budget' || pauseReason === 'turn-deadline'
    ? 'budget-exhausted'
    : 'stalled'
}

export type RoundDecision =
  | { next: 'end' }
  | { next: 'stop-gate' }
  | { next: 'budget-continuation'; pause: BudgetPauseKind }
  | { next: 'steer-continuation' }

export type RoundDecisionInput = {
  finishReason: string | undefined
  aborted: boolean
  /** The Auto Mode gate is holding a command for the user's approval. */
  authPending: boolean
  /** The runaway wrap-up fired this round: the model was spinning on one
   *  failing tool and was told to stop and report. */
  runawayNudged: boolean
  budgetContinuations: number
  stopGateContinuations: number
  /** The user sent something while this turn was running and it has not been
   *  delivered to the model yet (lib/agent/pending-messages.ts). */
  pendingUserMessages: boolean
  steerContinuations: number
}

/**
 * Decide what a finished round leads to. Order matters: an awaiting-approval
 * turn must be ruled out before anything else reads a continuation into it —
 * continuing there would talk over the approve/deny the user is looking at.
 */
export function decideRoundOutcome(input: RoundDecisionInput): RoundDecision {
  if (input.aborted || input.authPending) return { next: 'end' }
  // A real person typing beats every heuristic below — including the runaway
  // wrap-up, which a correcting message is often answering. Ending the turn
  // here would answer them in a turn that starts from scratch instead.
  if (input.pendingUserMessages && input.steerContinuations < MAX_STEER_CONTINUATIONS) {
    return { next: 'steer-continuation' }
  }
  if (input.finishReason === 'stop') {
    return input.stopGateContinuations >= MAX_STOP_GATE_CONTINUATIONS
      ? { next: 'end' }
      : { next: 'stop-gate' }
  }
  // A round that paused mid-work after the runaway wrap-up fired is spinning,
  // not working. Handing it a fresh budget would restart the very loop the
  // wrap-up exists to stop — the stop gate refuses the same round for the same
  // reason.
  if (input.runawayNudged) return { next: 'end' }
  const pause = budgetPauseKind(input.finishReason)

  if (!pause || input.budgetContinuations >= MAX_BUDGET_CONTINUATIONS) return { next: 'end' }

  return { next: 'budget-continuation', pause }
}

const KIND_INSTRUCTIONS: Record<BudgetPauseKind, string> = {
  'output-budget': [
    'The previous round hit this turn’s output-token cap mid-message. Your last message was truncated, not finished.',
    '',
    'Continue from exactly where the text stopped. Do not restart the message or repeat what you already wrote, and keep the remainder compact.',
  ].join('\n'),
}

export function budgetContinuationNudge(kind: BudgetPauseKind, priorContinuations: number): string {
  return [
    '## Continuation after a budget pause',
    '',
    KIND_INSTRUCTIONS[kind],
    '',
    `This is automatic continuation ${String(priorContinuations + 1)} of at most ${String(MAX_BUDGET_CONTINUATIONS)} for this turn. The user did not type anything — do not greet them, apologize, or narrate the pause; just continue the work.`,
  ].join('\n')
}
