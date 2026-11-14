import { openInputRequests } from '../../lib/agentInputRequests.ts'

import type { AgentConversation, AgentInputRequest } from '../../api/agent-types'

/** One row of the Inbox: an open question and the conversation that asked it. */
export type InboxQuestion = { conversation: AgentConversation; request: AgentInputRequest }

/**
 * The Inbox's rows: every open question waiting on the viewer as its
 * conversation's owner, once those answered on this device are set aside,
 * grouped by the conversation that asked. The newest question leads, and
 * brings the rest of its group with it. The badge counts these.
 */
export function inboxQuestions(
  conversations: readonly AgentConversation[],
  answered: ReadonlyMap<string, number>,
): InboxQuestion[] {
  const newest = conversations
    .filter((conversation) => conversation.isOwner)
    .flatMap((conversation) =>
      openInputRequests(conversation).map((request) => ({ conversation, request })),
    )
    .filter(({ request }) => !answered.has(request.id))
    .sort((a, b) => b.request.askedAt.localeCompare(a.request.askedAt))
  const order = [...new Set(newest.map((row) => row.conversation.sessionId))]

  return order.flatMap((id) => newest.filter((row) => row.conversation.sessionId === id))
}

/** {@link inboxQuestions} as the sidebar lists them: one group per conversation that asked. */
export function inboxGroups(rows: readonly InboxQuestion[]): InboxQuestion[][] {
  const groups: InboxQuestion[][] = []

  for (const row of rows) {
    const last = groups.at(-1)

    if (last?.[0]?.conversation.sessionId === row.conversation.sessionId) last.push(row)
    else groups.push([row])
  }

  return groups
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
