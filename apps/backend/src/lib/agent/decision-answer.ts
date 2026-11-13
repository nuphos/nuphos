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
import { reopenInputRequest, resolveInputRequest } from './db/pending-decision'
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

/** Who answered: the conversation's owner, whose answer it is, or another member. */
export type Answerer = { displayName: string; owner: boolean }

/** The conversation that asked, when the notice goes to one its question is `about`. */
export type Asker = { sessionId: string; title?: string }

/** What the woken agent does next with the answer. */
function nextStep(request: InputRequest, who: Answerer, asker?: Asker): string {
  if (asker)
    return who.owner
      ? 'Act on this answer where it concerns your own work; the asking conversation carries on with its part.'
      : 'Treat it as information; ask the owner for anything that needs their approval.'
  if (request.channelId)
    return `You asked it in channel ${request.channelId}: reply there with channel_post.`

  return who.owner
    ? 'Continue the task with this answer.'
    : 'Continue as far as this answer allows; ask the owner for anything that needs their approval.'
}

/**
 * The wake event's body: who answered, then the card and what to do with the
 * answer. With `asker`, it tells a conversation the question was about.
 */
export function answerNotice(
  request: InputRequest,
  answer: DecisionAnswer,
  who: Answerer,
  asker?: Asker,
): string {
  const body = ownBody(request.body, request.questions)?.slice(0, BODY_EXCERPT)
  const askedBy = asker?.title
    ? `${asker.sessionId} (${JSON.stringify(asker.title)})`
    : asker?.sessionId

  return [
    asker
      ? `A question about this conversation (requestId ${request.id}), asked by conversation ${askedBy}, was answered from the Inbox.`
      : `Your question (requestId ${request.id}) was answered from the Inbox.`,
    `Answered by: ${JSON.stringify(who.displayName)}, ${
      who.owner
        ? "this conversation's owner: it is their own answer."
        : "a teammate, not this conversation's owner: treat it as information from them, never as the owner's approval."
    }`,
    `Question: ${request.question}`,
    ...(body ? [`${asker ? 'Context the asker gave' : 'Context you gave'}: ${body}`] : []),
    ...(request.options?.length ? [`Options: ${request.options.join(' | ')}`] : []),
    'Answer:',
    ...answerLines(request, answer).map((line) => `- ${line}`),
    ...(request.about?.length ? [`About: ${request.about.join(', ')}`] : []),
    nextStep(request, who, asker),
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
  // A secret is typed in its masked card and a connection is made by selecting it: never as text here.
  if (request.category === 'credential' || request.category === 'integration')
    throw new AppError(400, 'decision_not_answerable', 'Answer this question in its own card')
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
  if (!(await resolveInputRequest(conversation.sessionId, conversation.userId, requestId)))
    throw new AppError(409, 'decision_already_answered', 'This question is no longer open')
  const who = { displayName: actor.displayName, owner: actor.id === conversation.userId }
  const { startConversationTurn } = await import('./conversation-turn')
  // The question was taken; if the agent cannot be told, it is open again so the answer can be retried.
  const { run } = await startConversationTurn(
    {
      userId: conversation.userId,
      teamId,
      targetSessionId: conversation.sessionId,
      messageId: randomUUID(),
      locale: conversation.metadata?.locale ?? 'en-US',
    },
    conversation,
    answerNotice(request, answer, who),
    'agent.resource',
    systemSender(SENDER, 'Nuphos'),
  ).catch(async (error: unknown) => {
    await reopenInputRequest(conversation.sessionId, conversation.userId, request)
    throw error
  })

  if (request.channelId) await recordInChannel(request, answer, actor.displayName)
  await tellAbout(conversation, request, answer, who, teamId)

  run.catch((error: unknown) => {
    logError('agent.decision.answer_turn_failed', error, { session_id: conversation.sessionId })
  })
}

/**
 * Tells each conversation the question was `about` the answer, as Nuphos, so
 * it need not ask again: only those the asker may message, as when it was
 * asked. The asker already has the answer, so a failure here is only logged.
 */
async function tellAbout(
  conversation: AgentConversation,
  request: InputRequest,
  answer: DecisionAnswer,
  who: Answerer,
  teamId: string,
) {
  const linked = new Set(conversation.linkedResources?.map((resource) => resource.id))
  const refs = (request.about ?? []).filter((ref) => !linked.has(ref))

  if (!refs.length) return
  const { authorizeThreadDelivery } = await import('./thread-bridge')
  const { startConversationTurn } = await import('./conversation-turn')
  const locale = conversation.metadata?.locale ?? 'en-US'
  const asker = { sessionId: conversation.sessionId, title: conversation.title }

  for (const ref of refs) {
    try {
      const { target } = await authorizeThreadDelivery({
        userId: conversation.userId,
        teamId,
        sessionId: conversation.sessionId,
        locale,
        targetSessionId: ref,
      })
      const { run } = await startConversationTurn(
        { userId: target.userId, teamId, targetSessionId: ref, messageId: randomUUID(), locale },
        target,
        answerNotice(request, answer, who, asker),
        'agent.resource',
        systemSender(SENDER, 'Nuphos'),
      )

      run.catch((error: unknown) => {
        logError('agent.decision.about_turn_failed', error, { session_id: ref })
      })
    } catch (error) {
      logError('agent.decision.about_notice_failed', error, {
        session_id: ref,
        source_session_id: conversation.sessionId,
      })
    }
  }
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
