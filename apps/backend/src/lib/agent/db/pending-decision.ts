import { ownBody, withQuestionsInBody } from '@/lib/agent/tools-skilled/decision-tools'
import { logEvent } from '@/lib/observability'

import { agentConversations } from './shared'

import type { PersonalCredentialRef } from '@/lib/agent/tools-skilled/decision-tools'
import type { ExplicitUserDecision } from '@/lib/agent/tools-skilled/types'

/**
 * A request_user_decision card the owner has to answer, kept on the conversation
 * so an Inbox can list it across sessions. `id` is the card's tool call id. The
 * conversation keeps only open requests: answering, dismissing or withdrawing
 * one removes it.
 */
export type InputRequest = ExplicitUserDecision & {
  id: string
  /** The secret a `credential` request asks for, so its secure card finds it. */
  secretName?: string
  /** The plan (#N) a plan's approval question decides. */
  planId?: string
  /** The channel whose post woke the turn that asked: the answer is recorded there and the agent replies there. */
  channelId?: string
  /** The providers an `integration` request asks to connect, so its Connect card lists them. */
  providers?: string[]
  /** The member's own credentials an `integration` request asks for: only selecting one answers it. */
  credentials?: PersonalCredentialRef[]
  /** The linked resources and sub-agent threads it is about: their changes remind the agent of it. */
  about?: string[]
  askedAt: Date
  /** Always 'open': clients still filter on it. */
  status: 'open'
}

/** The questions a conversation document keeps for its owner. */
export type ConversationInputRequests = {
  /** The open questions asked through request_user_decision. */
  inputRequests?: InputRequest[]
}

/** A new question joins the open ones; it never replaces another open request. */
export async function addInputRequest(
  sessionId: string,
  userId: string,
  request: Omit<InputRequest, 'status'>,
): Promise<void> {
  const entry: InputRequest = { ...request, status: 'open' }

  await agentConversations().updateOne(
    { sessionId, userId },
    { $push: { inputRequests: { $each: [entry] } } },
  )
}

/** The agent corrects a request while it is still open; an answered one stays as answered. */
export async function updateInputRequest(
  sessionId: string,
  userId: string,
  id: string,
  patch: Partial<
    Pick<ExplicitUserDecision, 'question' | 'body' | 'options' | 'multiSelect' | 'questions'>
  >,
): Promise<boolean> {
  // A card with questions keeps them written out after its body, for older clients.
  if (patch.questions || patch.body !== undefined) {
    const stored = await findInputRequest(sessionId, userId, id)
    const questions = patch.questions ?? stored?.questions

    if (!stored) return false
    if (questions?.length)
      patch = {
        ...patch,
        body: withQuestionsInBody({
          body: patch.body ?? ownBody(stored.body, stored.questions),
          questions,
        }),
      }
  }
  const set = Object.fromEntries(
    Object.entries(patch).map(([field, value]) => [`inputRequests.$.${field}`, value]),
  )
  const result = await agentConversations().updateOne(
    { sessionId, userId, 'inputRequests.id': id },
    { $set: set },
  )

  return result.matchedCount > 0
}

/** The conversation's open requests, oldest first, but those a queued message answers. */
export async function listOpenInputRequests(
  sessionId: string,
  userId: string,
  answering: ReadonlySet<string> = new Set(),
): Promise<InputRequest[]> {
  const conversation = await agentConversations().findOne(
    { sessionId, userId },
    { projection: { inputRequests: 1 } },
  )

  return conversation ? openInputRequests(conversation, answering) : []
}

/**
 * What a wake from a linked resource or sub-agent thread tells the agent about
 * the open questions it asked about that resource or thread; empty when none.
 */
export function relatedQuestionsNote(
  conversation: ConversationInputRequests,
  ref: string,
  what: string,
): string {
  const related = openInputRequests(conversation).filter((request) => request.about?.includes(ref))

  if (!related.length) return ''
  const list = related
    .map((request) => `- ${request.id}: ${JSON.stringify(request.question)}`)
    .join('\n')

  return `\n\nYour open questions about this ${what}:\n${list}\nIf this answers one or makes it moot, withdraw it with withdraw_user_decision or correct it with update_user_decision.`
}

/** One open request, by its id. */
export async function findInputRequest(
  sessionId: string,
  userId: string,
  id: string,
): Promise<InputRequest | undefined> {
  const conversation = await agentConversations().findOne(
    { sessionId, userId, 'inputRequests.id': id },
    { projection: { 'inputRequests.$': 1 } },
  )

  return conversation?.inputRequests?.[0]
}

/** An answer, dismissal or withdrawal takes the request off the list; false when it was not on it. */
export async function resolveInputRequest(
  sessionId: string,
  userId: string,
  id: string,
): Promise<boolean> {
  const result = await agentConversations().updateOne(
    { sessionId, userId, 'inputRequests.id': id },
    { $pull: { inputRequests: { id } } },
  )

  return result.matchedCount > 0
}

/** An answer whose agent could not be told: the question goes back on the list. */
export async function reopenInputRequest(sessionId: string, userId: string, request: InputRequest) {
  await agentConversations().updateOne(
    { sessionId, userId, 'inputRequests.id': { $ne: request.id } },
    { $push: { inputRequests: { $each: [request] } } },
  )
}

/** A plan decided anywhere (its card, the Plans page, Slack) is no longer asked about. */
export async function resolvePlanInputRequests(sessionId: string, planId: string): Promise<void> {
  await agentConversations().updateOne(
    { sessionId, 'inputRequests.planId': planId },
    { $pull: { inputRequests: { planId } } },
  )
}

/**
 * Conversations used to keep answered and dismissed requests as history. Drops
 * them; idempotent, a no-op once none remain.
 */
export async function dropResolvedInputRequests(): Promise<void> {
  const result = await agentConversations().updateMany(
    { 'inputRequests.status': { $in: ['answered', 'dismissed'] } },
    { $pull: { inputRequests: { status: { $ne: 'open' } } } },
  )

  if (result.modifiedCount > 0)
    logEvent('info', 'backend.migration.resolved_input_requests_dropped', {
      conversations: result.modifiedCount,
    })
}

/** Matches a conversation with any open request. */
export const OPEN_INPUT_REQUEST_FILTER = { 'inputRequests.status': 'open' }

/**
 * Every open request, oldest first. A request a queued message answers
 * (`answering`, from the session queue) waits on no one.
 */
export function openInputRequests(
  conversation: ConversationInputRequests,
  answering: ReadonlySet<string> = new Set(),
): InputRequest[] {
  return (conversation.inputRequests ?? [])
    .filter((request) => request.status === 'open' && !answering.has(request.id))
    .sort((a, b) => new Date(a.askedAt).getTime() - new Date(b.askedAt).getTime())
}
