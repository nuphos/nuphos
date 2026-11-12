// A person answers an agent's question. The answer is not a message: the
// question is resolved, a short record is kept where it was asked, and the
// asking agent is woken with the card and the answer, as a Trigger fire is.
import { randomUUID } from 'node:crypto'

import { AppError } from '@/lib/errors'
import { logError } from '@/lib/observability'

import {
  appendConversationMessages,
  bumpConversationActivity,
  getConversationBySessionId,
} from './db'
import { resolveInputRequest } from './db/pending-decision'
import { systemSender } from './message-metadata'
import { answerInputRequest } from './plan-decision'
import { ownBody } from './tools-skilled/decision-tools'

import type { AgentConversation } from './db'
import type { InputRequest } from './db/pending-decision'

/** What a person picked or typed: for one question, or per question of a card that asks several. */
export type DecisionAnswer = {
  choices?: string[]
  text?: string
  questions?: { choices?: string[]; text?: string }[]
}

const SENDER = 'nuphos:decision'
const BODY_EXCERPT = 600

function said({ choices, text }: { choices?: string[]; text?: string }): string {
  return text?.trim() || choices?.join(', ') || '(no answer)'
}

/** "Which regions? → us-east, eu-west", one line per question. */
export function answerLines(request: InputRequest, answer: DecisionAnswer): string[] {
  const questions = request.questions ?? []

  if (!questions.length) return [`${request.question} → ${said(answer)}`]

  return questions.map(
    (question, index) => `${question.question} → ${said(answer.questions?.[index] ?? {})}`,
  )
}

/** The wake event's body: the record line, then the card and what to do with the answer. */
export function answerNotice(request: InputRequest, answer: DecisionAnswer, who: string): string {
  const body = ownBody(request.body, request.questions)?.slice(0, BODY_EXCERPT)

  return [
    `${who} answered your question (requestId ${request.id}) from the Inbox. This is their own answer.`,
    `Question: ${request.question}`,
    ...(body ? [`Context you gave: ${body}`] : []),
    ...(request.options?.length ? [`Options: ${request.options.join(' | ')}`] : []),
    'Answer:',
    ...answerLines(request, answer).map((line) => `- ${line}`),
    ...(request.about?.length ? [`About: ${request.about.join(', ')}`] : []),
    request.channelId
      ? `You asked it in channel ${request.channelId}: reply there with channel_post.`
      : 'Continue the task with this answer.',
  ].join('\n')
}

/**
 * Resolves an open question with a person's answer and wakes the agent that
 * asked it. A plan's question decides the plan, whose own decision wakes the
 * agent. Refused once the question is no longer open.
 */
export async function answerDecision(args: {
  conversation: AgentConversation
  requestId: string
  answer: DecisionAnswer
  actor: { id: string; displayName: string }
  teamId: string
}): Promise<void> {
  const { conversation, requestId, answer, actor, teamId } = args
  const request = conversation.inputRequests?.find((entry) => entry.id === requestId)

  if (request?.status !== 'open')
    throw new AppError(409, 'decision_already_answered', 'This question is no longer open')
  if (request.planId) {
    await answerInputRequest({
      sessionId: conversation.sessionId,
      userId: conversation.userId,
      requestId,
      answer: said(answer),
      actorUserId: actor.id,
      teamId,
    })

    return
  }
  if (
    !(await resolveInputRequest(conversation.sessionId, conversation.userId, requestId, 'answered'))
  )
    throw new AppError(409, 'decision_already_answered', 'This question is no longer open')
  if (request.channelId) await recordInChannel(request, answer, actor.displayName)
  const { startConversationTurn } = await import('./conversation-turn')
  const { run } = await startConversationTurn(
    {
      userId: conversation.userId,
      teamId,
      targetSessionId: conversation.sessionId,
      messageId: randomUUID(),
      locale: conversation.metadata?.locale ?? 'en-US',
    },
    conversation,
    answerNotice(request, answer, actor.displayName),
    'agent.resource',
    systemSender(SENDER, 'Nuphos'),
  )

  run.catch((error: unknown) => {
    logError('agent.decision.answer_turn_failed', error, { session_id: conversation.sessionId })
  })
}

/** The answer's record in the channel the question was asked in. It wakes no one. */
async function recordInChannel(request: InputRequest, answer: DecisionAnswer, who: string) {
  const channel = request.channelId ? await getConversationBySessionId(request.channelId) : null

  if (!channel?.teamId) return
  await appendConversationMessages({
    sessionId: channel.sessionId,
    userId: channel.userId,
    teamId: channel.teamId,
    messages: [
      {
        id: randomUUID(),
        role: 'user',
        parts: answerLines(request, answer).map((line) => ({
          type: 'text',
          text: `${who} answered: ${line}`,
        })),
        metadata: systemSender(SENDER, 'Nuphos'),
      },
    ],
  })
  await bumpConversationActivity(channel.sessionId, channel.userId)
}
