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
 * The agents the viewer owns or was invited to, in one order of recent
 * activity, then the channels they own or joined: lists never mix the two, so
 * channels are their own listing. Anything shared with the whole team but
 * never joined stays out.
 */
export async function loadSidebarChats(
  readPage: ReadPage,
  isCurrent: () => boolean,
): Promise<AgentConversation[] | null> {
  const conversations = new Map<string, AgentConversation>()

  for (const listing of [
    { scope: 'mine' },
    { scope: 'shared' },
    { scope: 'mine', kind: 'channel' },
    { scope: 'shared', kind: 'channel' },
  ] as const) {
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
      for (const conversation of page.conversations) {
        if (!conversations.has(conversation.sessionId))
          conversations.set(conversation.sessionId, conversation)
      }
      cursor = page.nextCursor ?? undefined
      if (cursor && cursors.has(cursor)) throw new Error('Repeated conversation cursor')
      if (cursor) cursors.add(cursor)
    } while (cursor)
  }

  const rows = [...conversations.values()]
  // Each listing comes newest first; a stable sort keeps that within each.
  const agents = rows
    .filter((row) => row.kind !== 'channel')
    .sort((a, b) => activityTime(b) - activityTime(a))

  return [...agents, ...rows.filter((row) => row.kind === 'channel')]
}

function activityTime(conversation: AgentConversation): number {
  return Date.parse(conversation.lastActiveAt) || 0
}
