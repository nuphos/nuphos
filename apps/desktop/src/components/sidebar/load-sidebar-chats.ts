import type { AgentConversation, AgentConversationsPage } from '../../api/agent-types.ts'

/** 'mine' is the Chats section; 'shared' is sessions the viewer joined. */
export type SidebarChatScope = 'mine' | 'shared'

/** Page size is a transport bound, never a limit on the visible chat list. */
export async function loadSidebarChats(
  readPage: (options: {
    limit: number
    cursor?: string
    scope: SidebarChatScope
    archived: 'exclude'
    sort: 'created'
  }) => Promise<AgentConversationsPage>,
  isCurrent: () => boolean,
  scope: SidebarChatScope = 'mine',
): Promise<AgentConversation[] | null> {
  const conversations = new Map<string, AgentConversation>()
  const cursors = new Set<string>()
  let cursor: string | undefined

  do {
    const page = await readPage({
      limit: 100,
      scope,
      archived: 'exclude',
      sort: 'created',
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

  return [...conversations.values()]
}
