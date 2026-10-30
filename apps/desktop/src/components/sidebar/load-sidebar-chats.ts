import type { AgentConversation, AgentConversationsPage } from '../../api/agent-types.ts'

/**
 * Page size is a transport bound, never a limit on the visible chat list.
 * Channels the viewer is in come too, whoever created them: 'mine' only lists
 * what the viewer owns, so one page of 'shared' brings the rest.
 */
export async function loadSidebarChats(
  readPage: (options: {
    limit: number
    cursor?: string
    scope: 'mine' | 'shared'
    archived: 'exclude'
    sort: 'activity'
  }) => Promise<AgentConversationsPage>,
  isCurrent: () => boolean,
): Promise<AgentConversation[] | null> {
  const conversations = new Map<string, AgentConversation>()
  const cursors = new Set<string>()
  let cursor: string | undefined

  do {
    const page = await readPage({
      limit: 100,
      scope: 'mine',
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
  const shared = await readPage({
    limit: 100,
    scope: 'shared',
    archived: 'exclude',
    sort: 'activity',
  })

  if (!isCurrent()) return null
  for (const conversation of shared.conversations) {
    if (conversation.kind === 'channel' && !conversations.has(conversation.sessionId))
      conversations.set(conversation.sessionId, conversation)
  }

  return [...conversations.values()]
}
