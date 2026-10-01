// One bounded wait, inside the one MCP call that opened it.
// A wait exists only while something can still answer it: once the deadline
// passes, or the runtime has dropped the request, this settles it so the turn
// never parks on an answer that is not coming.
import { awaitPreviewDecision, expirePreviewWait } from '../decision-waiter'

import { DECISION_WAIT_MS, unansweredCardText, unansweredInstruction } from './decision-specs'

import type { PreviewDecision, PreviewWaitKind } from '../decision-waiter'

export type WaitOutcome =
  | { status: 'decided'; decision: PreviewDecision }
  | { status: 'unanswered'; payload: Record<string, unknown>; cardText: string }

export async function awaitDecisionOnce(args: {
  userId: string
  sessionId: string
  waitId: string
  kind: PreviewWaitKind
  timeoutMs?: number
}): Promise<WaitOutcome> {
  const startedAt = Date.now()
  const outcome = await awaitPreviewDecision({
    userId: args.userId,
    sessionId: args.sessionId,
    waitId: args.waitId,
    timeoutMs: args.timeoutMs ?? DECISION_WAIT_MS,
    keepOnTimeout: true,
  })

  if (!outcome.timedOut) return { status: 'decided', decision: outcome.decision }
  const waitedMs = Date.now() - startedAt

  if (outcome.reason !== 'vanished') await expirePreviewWait(args).catch(() => undefined)

  return {
    status: 'unanswered',
    payload: {
      status: 'unanswered',
      waited_seconds: Math.round(waitedMs / 1000),
      instruction: unansweredInstruction(args.kind),
    },
    cardText: unansweredCardText(args.kind, waitedMs),
  }
}
