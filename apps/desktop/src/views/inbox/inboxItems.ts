import { t } from '../../i18n/index.ts'
import { openInputRequests } from '../../lib/agentInputRequests.ts'

import type { AgentConversation, AgentInputRequest } from '../../api/agent-types'

/** Conversations still waiting once the questions answered on this device are set aside. */
export function inboxCount(
  conversations: readonly AgentConversation[],
  answered: ReadonlyMap<string, number>,
): number {
  return conversations.filter((conversation) =>
    openInputRequests(conversation).some((request) => !answered.has(request.id)),
  ).length
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
 * The conversation the Inbox shows after a listing. The open one stays open
 * while it still waits — listed, or confirmed by its own record when the list
 * no longer shows it. Once answered, the row that took its place opens, the
 * way a mail reader moves on. `index` only picks that next row.
 */
export function nextSelection(
  selected: { sessionId: string; index: number } | null,
  items: AgentConversation[],
  selectedStillWaits = false,
): string | null {
  if (selected && (selectedStillWaits || items.some((i) => i.sessionId === selected.sessionId))) {
    return selected.sessionId
  }
  if (items.length === 0) return null

  // An off-page selection has index -1: the next row is then the first.
  const index = Math.max(0, Math.min(selected?.index ?? 0, items.length - 1))

  return items[index]!.sessionId
}

/**
 * The open question a reply from the Inbox answers: the one the reader chose
 * while it is still open, else the newest, the same default as the chat's chip.
 */
export function replyTarget(
  open: readonly AgentInputRequest[],
  chosen: string | null,
): string | undefined {
  return open.find((request) => request.id === chosen)?.id ?? open.at(-1)?.id
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
