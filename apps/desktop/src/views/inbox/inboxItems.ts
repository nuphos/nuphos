import type { AgentConversation, AgentInputRequest } from '../../api/agent-types'

/** One listing of the Inbox: whose it is, and which request produced it. */
export type InboxListing = { teamId: string; count: number; requestNo: number }

/** Another team's listing is no answer for this one: show nothing until this team's arrives. */
export function listingFor(listing: InboxListing | null, teamId: string): InboxListing | null {
  return listing?.teamId === teamId ? listing : null
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
 * while it is still open, else the oldest.
 */
export function replyTarget(
  open: readonly AgentInputRequest[],
  chosen: string | null,
): string | undefined {
  return open.find((request) => request.id === chosen)?.id ?? open[0]?.id
}

/** Shown beside a row's title when the conversation waits on several questions; one shows none. */
export function openQuestionCount(open: number): string | null {
  return open > 1 ? `${String(open)} questions` : null
}
