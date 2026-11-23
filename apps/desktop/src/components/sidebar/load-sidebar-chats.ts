import type { AgentConversation, AgentConversationsPage } from '../../api/agent-types.ts'

type ReadPage = (options: {
  limit: number
  cursor?: string
  scope: 'mine' | 'shared'
  kind?: 'channel'
  archived: 'exclude'
  sort: 'activity'
}) => Promise<AgentConversationsPage>

/**
 * Page size is a transport bound, never a limit on the visible chat list.
 * The agents the viewer owns or was invited to and the channels they own or
 * joined, in one order of recent activity. The server lists the two apart, so
 * channels are their own listing. Anything shared with the whole team but
 * never joined stays out.
 *
 * Given the rows `listed` before, it reads only each listing's first page (#4710). A chat
 * changes page only by new activity, which brings it to the first page; an archive, Undo or
 * rename edits the listed rows directly and lists again in full.
 */
export async function loadSidebarChats(
  readPage: ReadPage,
  isCurrent: () => boolean,
  listed?: AgentConversation[],
): Promise<AgentConversation[] | null> {
  const conversations = new Map<string, AgentConversation>()
  // Rows at or before this time may sit on a page not read again.
  let unread = -Infinity

  for (const listing of LISTINGS) {
    const read = await readListing(readPage, listing, isCurrent, Boolean(listed))

    if (!read) return null
    for (const conversation of read.rows) {
      if (!conversations.has(conversation.sessionId))
        conversations.set(conversation.sessionId, conversation)
    }
    unread = Math.max(unread, read.unread)
  }

  // A listed row missing from the first pages is gone, unless a later page may still hold it.
  for (const row of listed ?? []) {
    if (!conversations.has(row.sessionId) && activityTime(row) <= unread)
      conversations.set(row.sessionId, row)
  }

  // Agents and group chats share one list (Chats), newest activity first.
  return [...conversations.values()].sort((a, b) => activityTime(b) - activityTime(a))
}

const LISTINGS = [
  { scope: 'mine' },
  { scope: 'shared' },
  { scope: 'mine', kind: 'channel' },
  { scope: 'shared', kind: 'channel' },
] as const

/** One listing's rows, every page or only the first; null once it is no longer current. */
async function readListing(
  readPage: ReadPage,
  listing: (typeof LISTINGS)[number],
  isCurrent: () => boolean,
  firstPageOnly: boolean,
): Promise<{ rows: AgentConversation[]; unread: number } | null> {
  const rows: AgentConversation[] = []
  const cursors = new Set<string>()
  let cursor: string | undefined

  do {
    const page = await readPage({
      limit: 100,
      ...listing,
      archived: 'exclude',
      sort: 'activity',
      ...(cursor ? { cursor } : {}),
    })

    if (!isCurrent()) return null
    rows.push(...page.conversations)
    cursor = page.nextCursor ?? undefined
    if (cursor && firstPageOnly) {
      const last = page.conversations.at(-1)

      return { rows, unread: last ? activityTime(last) : Infinity }
    }
    if (cursor && cursors.has(cursor)) throw new Error('Repeated conversation cursor')
    if (cursor) cursors.add(cursor)
  } while (cursor)

  return { rows, unread: -Infinity }
}

function activityTime(conversation: AgentConversation): number {
  return Date.parse(conversation.lastActiveAt) || 0
}
