import { t } from '../../i18n/index.ts'
import { openInputRequests } from '../../lib/agentInputRequests.ts'

import type { AgentConversation, AgentInputRequest } from '../../api/agent-types'

/** One row of the Inbox: an open question and the conversation that asked it. */
export type InboxQuestion = { conversation: AgentConversation; request: AgentInputRequest }

/**
 * The Inbox's rows: every open question waiting on the viewer as its
 * conversation's owner, newest first, once those answered on this device are
 * set aside. The badge counts these.
 */
export function inboxQuestions(
  conversations: readonly AgentConversation[],
  answered: ReadonlyMap<string, number>,
): InboxQuestion[] {
  return conversations
    .filter((conversation) => conversation.isOwner)
    .flatMap((conversation) =>
      openInputRequests(conversation).map((request) => ({ conversation, request })),
    )
    .filter(({ request }) => !answered.has(request.id))
    .sort((a, b) => b.request.askedAt.localeCompare(a.request.askedAt))
}

/** How many rows {@link inboxQuestions} has. */
export function inboxCount(
  conversations: readonly AgentConversation[],
  answered: ReadonlyMap<string, number>,
): number {
  return inboxQuestions(conversations, answered).length
}

/**
 * The answered questions a listing settles: those it no longer has open, and
 * those past their deadline, which the listing then shows as they are.
 */
export function answeredIn(
  conversations: readonly AgentConversation[],
  answered: ReadonlyMap<string, number>,
  now: number,
): string[] {
  const open = new Set(
    conversations.flatMap((conversation) => openInputRequests(conversation).map((r) => r.id)),
  )

  return [...answered].filter(([id, until]) => !open.has(id) || until < now).map(([id]) => id)
}

/**
 * The row the Inbox opens: the selected one while it is listed. Once answered,
 * the row that took its place opens, the way a mail reader moves on.
 */
export function openQuestion(
  rows: readonly InboxQuestion[],
  selected: { id: string; index: number } | null,
): InboxQuestion | undefined {
  const kept = selected && rows.find((row) => row.request.id === selected.id)

  if (kept) return kept

  return rows[Math.max(0, Math.min(selected?.index ?? 0, rows.length - 1))]
}

/** Connect and secure-input cards live in the transcript; only there can these be answered. */
const ANSWERED_IN_CONVERSATION = new Set(['credential', 'integration'])

/**
 * The replies a card offers, each sent to the conversation as the answer to
 * its question: one per choice, or "Done." for a to-do, so the agent goes on.
 * Null when the question can only be answered in the conversation.
 */
export function cardReplies(
  request: Pick<AgentInputRequest, 'category' | 'options'>,
): { label: string; reply: string }[] | null {
  if (ANSWERED_IN_CONVERSATION.has(request.category)) return null
  if (request.options?.length)
    return request.options.map((option) => ({ label: option, reply: option }))

  return [{ label: t('Mark as done'), reply: 'Done.' }]
}
