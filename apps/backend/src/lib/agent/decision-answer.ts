// A person answers an agent's question. The answer is not a message: the
// question is resolved, the person's reply is recorded where it was asked, and
// the asking agent is woken with the card and the answer, as a Trigger fire is.
import { randomUUID } from 'node:crypto'

import { AppError } from '@/lib/errors'
import { logError } from '@/lib/observability'

import { answered, recordInChannel } from './decision-channel-reply'
import { reopenInputRequest, resolveInputRequest } from './db/pending-decision'
import { systemSender } from './message-metadata'
import { ownBody } from './tools-skilled/decision-tools'

import type { AgentConversation } from './db'
import type { Actor, DecisionAnswer } from './decision-channel-reply'
import type { InputRequest } from './db/pending-decision'

export type { DecisionAnswer }

const SENDER = 'nuphos:decision'
const BODY_EXCERPT = 600

/** "Which regions? → us-east, eu-west", one line per question. */
export function answerLines(request: InputRequest, answer: DecisionAnswer): string[] {
  return answered(request, answer).map((entry) => `${entry.question} → ${entry.said}`)
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
      ? `A question about this conversation (requestId ${request.id}), asked by conversation ${askedBy}, was answered.`
      : `Your question (requestId ${request.id}) was answered.`,
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
 * asked it. Refused once the question is no longer open.
 */
export async function answerDecision(args: {
  conversation: AgentConversation
  requestId: string
  answer: DecisionAnswer
  actor: Actor
  teamId: string
}): Promise<void> {
  const { conversation, requestId, answer, actor, teamId } = args
  const request = conversation.inputRequests?.find((entry) => entry.id === requestId)

  if (request?.status !== 'open')
    throw new AppError(409, 'decision_already_answered', 'This question is no longer open')
  // A secret is typed in its masked card and a connection is made by selecting it: never as text here.
  // An integration question naming nothing to select, e.g. a service Nuphos cannot connect, takes words.
  if (
    (request.category === 'integration' &&
      (Boolean(request.providers?.length) || Boolean(request.credentials?.length))) ||
    (request.category === 'credential' && !credentialChoice(request, answer))
  )
    throw new AppError(400, 'decision_not_answerable', 'Answer this question in its own card')
  if (!(await resolveInputRequest(conversation.sessionId, conversation.userId, requestId)))
    throw new AppError(409, 'decision_already_answered', 'This question is no longer open')
  const who = { displayName: actor.displayName, owner: actor.id === conversation.userId }

  await wakeAsker(conversation, request, teamId, answerNotice(request, answer, who))
  if (request.channelId) await recordInChannel(conversation, request, answer, actor)
  await tellAbout(conversation, request, answer, who, teamId)
}

/**
 * A person dismisses an open question: it is closed and the agent that asked is woken to
 * carry on without it, with the reason when one was given. Refused once it is no longer open.
 */
export async function dismissDecision(args: {
  conversation: AgentConversation
  requestId: string
  actor: { id: string; displayName: string }
  teamId: string
  reason?: string
}): Promise<void> {
  const { conversation, requestId, actor, teamId, reason } = args
  const request = conversation.inputRequests?.find((entry) => entry.id === requestId)

  if (
    !request ||
    !(await resolveInputRequest(conversation.sessionId, conversation.userId, requestId))
  )
    throw new AppError(409, 'decision_already_answered', 'This question is no longer open')
  const by = `${JSON.stringify(actor.displayName)}, ${actor.id === conversation.userId ? "this conversation's owner" : 'a teammate'}`

  await wakeAsker(
    conversation,
    request,
    teamId,
    [
      `Your question (requestId ${request.id}) was dismissed by ${by}: no answer is coming.`,
      ...(reason ? [`Reason: ${JSON.stringify(reason)}`] : []),
      `Question: ${request.question}`,
      'Carry on without it as far as you can and say what you assumed. Do not ask it again unless something has changed.',
    ].join('\n'),
  )
}

/**
 * Wakes the agent that asked with what became of its question, which is
 * already taken: if the agent cannot be told, now or once its turn comes, the
 * question is open again so it can be retried.
 */
async function wakeAsker(
  conversation: AgentConversation,
  request: InputRequest,
  teamId: string,
  notice: string,
) {
  const { startConversationTurn } = await import('./conversation-turn')
  const { run } = await startConversationTurn(
    {
      userId: conversation.userId,
      teamId,
      targetSessionId: conversation.sessionId,
      messageId: randomUUID(),
      locale: conversation.metadata?.locale ?? 'en-US',
      answers: request,
    },
    conversation,
    notice,
    'agent.resource',
    systemSender(SENDER, 'Nuphos'),
  ).catch(async (error: unknown) => {
    await reopenInputRequest(conversation.sessionId, conversation.userId, request)
    throw error
  })

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

/**
 * A credential question with options is a choice like any other: one of them, or words, as with
 * Other… (#4029). A secret card, or one with no options, asks for a value, which never enters here.
 */
function credentialChoice(request: InputRequest, answer: DecisionAnswer): boolean {
  if (request.secretName || request.questions?.length || !request.options?.length) return false
  if (answer.questions !== undefined) return false
  const picked = answer.choices ?? []

  if (answer.text !== undefined) return picked.length === 0 && answer.text.trim() !== ''

  return picked.length > 0 && picked.every((choice) => request.options?.includes(choice))
}
