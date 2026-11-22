export function conversationSummary(
  c: {
    sessionId: string
    title: string
    createdAt: Date
    lastActiveAt: Date
    messageCount: number
    archivedAt?: Date
    userId: string
    parentSessionId?: string
    avatar?: string
  },
  viewerUserId: string,
  currentSessionId: string,
) {
  return {
    session_id: c.sessionId,
    title: c.title,
    created_at: c.createdAt.toISOString(),
    last_active_at: c.lastActiveAt.toISOString(),
    message_count: c.messageCount,
    is_bot: Boolean(c.avatar),
    ...(c.parentSessionId ? { parent_session_id: c.parentSessionId } : {}),
    ...(c.archivedAt ? { archived: true } : {}),
    ...(c.userId === viewerUserId ? {} : { owner: 'teammate' }),
    ...(c.sessionId === currentSessionId ? { is_current_conversation: true } : {}),
  }
}
