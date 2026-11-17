// A proposed plan is a question for its owner, asked like request_user_decision
// asks one. Answering it with an option approves or rejects the plan before
// the answer's turn runs, so the answer itself wakes the agent to act on it,
// wherever it was given: the Task, a Bot's chat, the Inbox or the Plans page.
import {
  addInputRequest,
  findInputRequest,
  resolveInputRequest,
  resolvePlanInputRequests,
} from '@/lib/agent/db'
import { journalPlanDecision } from '@/lib/agent/journal-capture'
import { isPlanReadyForApproval } from '@/lib/agent/plan-readiness'
import { assertPlanAccess, getPlan, recordPlanApproval, updatePlan } from '@/lib/agent/plans'
import { AppError } from '@/lib/errors'
import { logError } from '@/lib/observability'

import type { PlanDTO } from '@/lib/agent/plans'
import type { UIMessage } from 'ai'

export const APPROVE_PLAN = 'Approve'
export const REJECT_PLAN = 'Reject'

/**
 * Asks the owner to decide each plan a turn proposed, under its card's id, so
 * the card and the question are one item wherever it shows.
 */
export async function askPlanDecisions(
  sessionId: string,
  ownerUserId: string,
  plans: Pick<PlanDTO, 'id' | 'title' | 'status'>[],
  cards: { toolCallId: string; output?: unknown }[],
): Promise<void> {
  for (const plan of plans) {
    const card = cards.find((step) => (step.output as { planId?: string }).planId === plan.id)

    if (plan.status !== 'proposed' || !card) continue
    await addInputRequest(sessionId, ownerUserId, {
      id: card.toolCallId,
      category: 'approval',
      question: plan.title
        ? `Approve plan #${plan.id}: ${plan.title}?`
        : `Approve plan #${plan.id}?`,
      options: [APPROVE_PLAN, REJECT_PLAN],
      planId: plan.id,
      askedAt: new Date(),
    }).catch((err: unknown) => {
      logError('agent.plan.question_failed', err, { plan_id: plan.id, session_id: sessionId })
    })
  }
}

/** Records one approval; a team quorum may still leave the plan proposed. */
export async function approvePlanForCaller(input: {
  planId: string
  teamId?: string
  userId: string
}): Promise<{ plan: PlanDTO; recorded: boolean; thresholdReached: boolean }> {
  const current = await getPlan(input.planId, { teamId: input.teamId, userId: input.userId })

  if (!current) throw new AppError(404, 'not_found', 'Plan not found')
  await assertPlanAccess(current, input.userId, 'reply')
  if (current.status !== 'proposed') {
    throw new AppError(409, 'plan_not_proposed', `This plan is already ${current.status}.`, {
      status: current.status,
    })
  }
  if (!isPlanReadyForApproval(current)) {
    throw new AppError(
      409,
      'plan_incomplete',
      'Plan must include steps, cost, and risk before approval',
    )
  }

  const result = await recordPlanApproval(
    input.planId,
    { teamId: input.teamId, userId: input.userId },
    input.userId,
  )

  // Another approval moved the plan on between the read above and this vote.
  if (!result.plan) {
    throw new AppError(
      409,
      'approval_race_lost',
      'This plan was just approved — no need to approve it again.',
    )
  }
  if (result.thresholdReached) {
    if (result.plan.sourceConversationId)
      await resolvePlanInputRequests(result.plan.sourceConversationId, result.plan.id)
    await journalPlanDecision(
      result.plan,
      { userId: input.userId, teamId: input.teamId ?? null },
      'approved',
    )
  }

  return { plan: result.plan, recorded: result.recorded, thresholdReached: result.thresholdReached }
}

async function rejectPlanForCaller(input: { planId: string; teamId?: string; userId: string }) {
  const scope = { teamId: input.teamId, userId: input.userId }
  const current = await getPlan(input.planId, scope)

  if (!current) throw new AppError(404, 'not_found', 'Plan not found')
  await assertPlanAccess(current, input.userId, 'reply')
  if (current.status !== 'proposed') return
  const plan = await updatePlan(
    input.planId,
    { status: 'rejected', rejectedBy: input.userId },
    scope,
  )

  if (plan)
    await journalPlanDecision(
      plan,
      { userId: input.userId, teamId: scope.teamId ?? null },
      'rejected',
    )
}

/**
 * A person answered a question. A plan's question decides the plan first, so
 * the answer's turn finds it approved. Any other reply (a question, a change
 * request) leaves the plan as it is: only the card's options decide it, never
 * a typed "ok".
 */
export async function answerInputRequest(args: {
  sessionId: string
  /** The conversation's owner, whose questions these are. */
  userId: string
  requestId: string
  answer: string
  /** Who answered, when not the owner. */
  actorUserId?: string
  teamId?: string
}): Promise<void> {
  const request = await findInputRequest(args.sessionId, args.userId, args.requestId)

  // A plan's question stays open until the plan itself is decided.
  if (request?.planId) await applyPlanAnswer(request.planId, args)
  else await resolveInputRequest(args.sessionId, args.userId, args.requestId)
}

async function applyPlanAnswer(
  planId: string,
  args: Parameters<typeof answerInputRequest>[0],
): Promise<void> {
  const answer = args.answer.trim()

  if (answer !== APPROVE_PLAN && answer !== REJECT_PLAN) return
  const input = { planId, teamId: args.teamId, userId: args.actorUserId ?? args.userId }

  try {
    await (answer === APPROVE_PLAN ? approvePlanForCaller(input) : rejectPlanForCaller(input))
  } catch (err: unknown) {
    // The turn still runs: the agent reads the plan's real status with get.sh.
    logError('agent.plan.answer_failed', err, { plan_id: planId, session_id: args.sessionId })
  }
}

/**
 * A person's message answers the question it names with `decisionReplyTo`.
 * A message that names none answers nothing: questions stay open until
 * answered, dismissed or withdrawn.
 */
export async function answerHumanTurn(args: {
  sessionId: string
  userId: string
  actorUserId?: string
  teamId?: string
  decisionReplyTo?: string
  messages: UIMessage[]
}): Promise<void> {
  if (!args.decisionReplyTo) return
  const said = args.messages.findLast((message) => message.role === 'user')
  const answer = (said?.parts ?? []).flatMap((part) => (part.type === 'text' ? [part.text] : []))

  await answerInputRequest({ ...args, requestId: args.decisionReplyTo, answer: answer.join('\n') })
}
