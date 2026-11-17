import { attentionInputRequests } from '../../lib/agentInputRequests.ts'
import { nearestBot } from '../../lib/nearestBot.ts'

import type { AgentConversation, AgentInputRequest } from '../../api/agent-types'

/**
 * One row of the Inbox: an open question and the conversation that asked it,
 * with the Bot that conversation works under when it is a Bot's task.
 */
export type InboxQuestion = {
  conversation: AgentConversation
  request: AgentInputRequest
  bot?: AgentConversation
}

/** The Bot a task works under, as the sidebar files it; a Bot itself works under none. */
export function botAbove(
  conversation: AgentConversation,
  byId: ReadonlyMap<string, AgentConversation>,
  isBot: (conversation: AgentConversation) => boolean,
): AgentConversation | undefined {
  if (isBot(conversation)) return undefined

  return nearestBot(
    conversation.parentSessionId,
    (id) => byId.get(id),
    isBot,
    (row) => row.parentSessionId,
  )
}

/** Who a row is listed under: its Bot, else the conversation that asked. */
export const inboxSource = (row: InboxQuestion): AgentConversation => row.bot ?? row.conversation

/** Its owner set it aside until a time still to come. */
export const isSnoozed = (request: AgentInputRequest, now: number) =>
  Boolean(request.snoozedUntil && Date.parse(request.snoozedUntil) > now)

/**
 * The Inbox's rows: every open question waiting on the viewer as its
 * conversation's owner, once those answered on this device are set aside,
 * grouped by the Bot that asked or whose task did, else by the Task that asked.
 * The newest question leads, and brings the rest of its group with it. The badge counts these.
 * A snoozed question is not among them until its time; with `snoozed`, only those are.
 */
export function inboxQuestions(
  conversations: readonly AgentConversation[],
  answered: ReadonlyMap<string, number>,
  botOf?: (conversation: AgentConversation) => AgentConversation | undefined,
  { snoozed = false, now = Date.now() }: { snoozed?: boolean; now?: number } = {},
): InboxQuestion[] {
  const newest = conversations
    .filter((conversation) => conversation.isOwner)
    .flatMap((conversation) => {
      const bot = botOf?.(conversation)

      return attentionInputRequests(conversation).map((request) => ({ conversation, request, bot }))
    })
    .filter(({ request }) => !answered.has(request.id) && isSnoozed(request, now) === snoozed)
    .sort((a, b) => b.request.askedAt.localeCompare(a.request.askedAt))
  const order = [...new Set(newest.map((row) => inboxSource(row).sessionId))]

  return order.flatMap((id) => newest.filter((row) => inboxSource(row).sessionId === id))
}

/** {@link inboxQuestions} as the sidebar lists them: one group per Bot or Task. */
export function inboxGroups(rows: readonly InboxQuestion[]): InboxQuestion[][] {
  const groups: InboxQuestion[][] = []

  for (const row of rows) {
    const last = groups.at(-1)

    if (last && inboxSource(last[0]).sessionId === inboxSource(row).sessionId) last.push(row)
    else groups.push([row])
  }

  return groups
}

/** How many rows {@link inboxQuestions} has. */
export function inboxCount(
  conversations: readonly AgentConversation[],
  answered: ReadonlyMap<string, number>,
  now?: number,
): number {
  return inboxQuestions(conversations, answered, undefined, { now }).length
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
    conversations.flatMap((conversation) => attentionInputRequests(conversation).map((r) => r.id)),
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
