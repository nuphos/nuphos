import type {
  AgentConversation,
  AgentConversationsPage,
  ChannelFace,
} from '../../api/agent-types.ts'

/** A Bot's chat is a channel whose one other member is the Bot, unless it began as a group. */
export function botOfChannel(
  chat: { faces?: ChannelFace[]; group?: true } | null | undefined,
): string | undefined {
  const faces = chat?.group ? undefined : chat?.faces

  return faces?.length === 1 && faces[0]?.agent ? faces[0].id : undefined
}

/** One page of the viewer's channels, archived ones included. */
export type ReadChannelPage = (cursor?: string) => Promise<AgentConversationsPage>

function activityTime(conversation: AgentConversation): number {
  return Date.parse(conversation.lastActiveAt) || 0
}

/** Every chat a Bot has, archived ones too, newest activity first. */
export async function readBotChats(
  readPage: ReadChannelPage,
  botId: string,
): Promise<AgentConversation[]> {
  const chats: AgentConversation[] = []
  const cursors = new Set<string>()
  let cursor: string | undefined

  do {
    const page = await readPage(cursor)

    chats.push(...page.conversations.filter((chat) => botOfChannel(chat) === botId))
    cursor = page.nextCursor ?? undefined
    if (cursor && cursors.has(cursor)) break
    if (cursor) cursors.add(cursor)
  } while (cursor)

  return chats.sort((a, b) => activityTime(b) - activityTime(a))
}

/**
 * Which chat to open for a Bot: one it already has, else the latest it had
 * archived, brought back. Null only when it never had one, the one time a
 * new chat is made; otherwise every open would leave another empty chat.
 */
export function chooseBotChat(
  chats: readonly AgentConversation[],
): { chatId: string; archived: boolean } | null {
  const open = chats.find((chat) => !chat.archivedAt)

  if (open) return { chatId: open.sessionId, archived: false }
  const latest = chats.at(0)

  return latest ? { chatId: latest.sessionId, archived: true } : null
}

/** The chats to file away when a Bot turns back into a Task: every one still open. */
export function openBotChats(chats: readonly AgentConversation[]): string[] {
  return chats.filter((chat) => !chat.archivedAt).map((chat) => chat.sessionId)
}
