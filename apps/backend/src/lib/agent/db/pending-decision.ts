import { agentConversations } from './shared'

import type { ExplicitUserDecision } from '@/lib/agent/tools-skilled/types'

/**
 * The single question a session waited on before requests became a list. Still
 * read from older documents, and still sent (the oldest open request) so older
 * Desktop builds keep working.
 */
export type PendingDecision = ExplicitUserDecision & { toolCallId: string; askedAt: Date }

export type InputRequestStatus = 'open' | 'answered' | 'dismissed'

/**
 * A request_user_decision card the owner has to answer, kept on the conversation
 * so an Inbox can list it across sessions. `id` is the card's tool call id. Only
 * an explicit answer or dismissal of that id resolves it.
 */
export type InputRequest = ExplicitUserDecision & {
  id: string
  askedAt: Date
  status: InputRequestStatus
  resolvedAt?: Date
}

/** The questions a conversation document keeps for its owner. */
export type ConversationInputRequests = {
  /** Read only: the one question documents kept before inputRequests. */
  pendingDecision?: PendingDecision
  /** Questions asked through request_user_decision, open and resolved. */
  inputRequests?: InputRequest[]
}

/** Resolved requests are kept for history; the oldest fall off past this many. */
const MAX_INPUT_REQUESTS = 100

/** A new question joins the open ones; it never replaces another open request. */
export async function addInputRequest(
  sessionId: string,
  userId: string,
  request: ExplicitUserDecision & { id: string; askedAt: Date },
): Promise<void> {
  const entry: InputRequest = { ...request, status: 'open' }

  await agentConversations().updateOne(
    { sessionId, userId },
    { $push: { inputRequests: { $each: [entry], $slice: -MAX_INPUT_REQUESTS } } },
  )
}

export async function resolveInputRequest(
  sessionId: string,
  userId: string,
  id: string,
  resolution: Exclude<InputRequestStatus, 'open'>,
): Promise<boolean> {
  const listed = await agentConversations().updateOne(
    { sessionId, userId, inputRequests: { $elemMatch: { id, status: 'open' } } },
    { $set: { 'inputRequests.$.status': resolution, 'inputRequests.$.resolvedAt': new Date() } },
  )
  // A document from before the list keeps its one question here.
  const legacy = await agentConversations().updateOne(
    { sessionId, userId, 'pendingDecision.toolCallId': id },
    { $unset: { pendingDecision: '' } },
  )

  return listed.matchedCount > 0 || legacy.matchedCount > 0
}

/** Legacy non-Desktop channels answer every open question with their next human turn. */
export async function clearPendingDecision(sessionId: string, userId: string): Promise<void> {
  await agentConversations().updateOne(
    { sessionId, userId, 'inputRequests.status': 'open' },
    {
      $set: {
        'inputRequests.$[open].status': 'answered',
        'inputRequests.$[open].resolvedAt': new Date(),
      },
    },
    { arrayFilters: [{ 'open.status': 'open' }] },
  )
  await agentConversations().updateOne(
    { sessionId, userId, pendingDecision: { $exists: true } },
    { $unset: { pendingDecision: '' } },
  )
}

/** Matches a conversation with any open request, listed or legacy. */
export const OPEN_INPUT_REQUEST_FILTER = {
  $or: [{ 'inputRequests.status': 'open' }, { pendingDecision: { $exists: true } }],
}

/** Every open request, the legacy one included, oldest first. */
export function openInputRequests(conversation: ConversationInputRequests): InputRequest[] {
  const listed = conversation.inputRequests ?? []
  const open = listed.filter((request) => request.status === 'open')
  const legacy = conversation.pendingDecision

  if (legacy && !listed.some((request) => request.id === legacy.toolCallId)) {
    const { toolCallId, ...rest } = legacy

    open.push({ ...rest, id: toolCallId, status: 'open' })
  }

  return open.sort((a, b) => new Date(a.askedAt).getTime() - new Date(b.askedAt).getTime())
}

/** The oldest open request in the single-question shape older clients read. */
export function legacyPendingDecision(open: InputRequest[]): PendingDecision | undefined {
  const oldest = open[0]

  if (!oldest) return undefined
  const { id, status: _status, resolvedAt: _resolvedAt, ...rest } = oldest

  return { ...rest, toolCallId: id }
}
