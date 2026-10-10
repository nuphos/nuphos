import { tool } from 'ai'
import { z } from 'zod'

import { getConversations, getConversationTranscriptForAgent } from './db'
import { withLabel } from './tools-skilled/labeling'

const LIST_DESCRIPTION =
  'List the most recent conversations in this workspace (newest first), optionally filtered by a substring of their title or first message. ' +
  'Pages with cursor — pass the returned next_cursor to continue. ' +
  'Use it when the user refers to an earlier conversation — "what did we decide last time", "the chat from this morning about billing", "that cluster we set up" — to find it by title, topic or recency before asking them to repeat themselves, then read_conversation to read it.'

const READ_DESCRIPTION =
  "Read one conversation's transcript in compact form: one line per message (`#index role: text`), tool calls summarized as `[tool: name]`. " +
  'Pages by message index — pass the returned next_index to continue. Read only the window you need. ' +
  'Turn termination records are returned separately in turn_diagnostics, even when transcript text is truncated; timestamps describe backend observations and missing fields were not recorded. ' +
  'Tool inputs/outputs are omitted by default to keep the transcript small; set include_tool_details only when the exact command or result matters.'

function conversationSummary(
  c: {
    sessionId: string
    title: string
    createdAt: Date
    lastActiveAt: Date
    messageCount: number
    archivedAt?: Date
    userId: string
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
    ...(c.archivedAt ? { archived: true } : {}),
    ...(c.userId === viewerUserId ? {} : { owner: 'teammate' }),
    ...(c.sessionId === currentSessionId ? { is_current_conversation: true } : {}),
  }
}

export function createSessionTools(
  userId: string,
  conversationId: string,
  teamId: string | null | undefined,
) {
  if (!teamId) return {}

  const listShape = {
    limit: z.number().int().min(1).max(30).optional().describe('Max conversations (default 15).'),
    cursor: z.string().min(1).max(64).optional().describe('next_cursor from the previous page.'),
    search: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('Substring to match against conversation titles / first messages.'),
    scope: z
      .enum(['mine', 'team'])
      .optional()
      .describe(
        "'mine' (default) lists only the user's conversations; 'team' lists every teammate's.",
      ),
  }
  const list_recent_conversations = withLabel(
    tool({
      description: LIST_DESCRIPTION,
      inputSchema: z.object(listShape),
      execute: async ({ limit, search, scope, cursor }) => {
        const { conversations, nextCursor } = await getConversations(userId, {
          teamId,
          limit: limit ?? 15,
          search,
          scope: scope ?? 'mine',
          cursor,
        })

        return {
          conversations: conversations.map((c) => conversationSummary(c, userId, conversationId)),
          next_cursor: nextCursor,
        }
      },
    }),
    listShape,
  )

  const readShape = {
    session_id: z.string().min(1).max(128).describe('Conversation to read.'),
    from_index: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Message index to start from (default 0).'),
    limit: z.number().int().min(1).max(60).optional().describe('Messages per page (default 40).'),
    include_tool_details: z
      .boolean()
      .optional()
      .describe('Include tool call inputs and outputs (clipped). Default false.'),
  }
  const read_conversation = withLabel(
    tool({
      description: READ_DESCRIPTION,
      inputSchema: z.object(readShape),
      execute: async ({ session_id, from_index, limit, include_tool_details }) => {
        const page = await getConversationTranscriptForAgent(userId, {
          teamId,
          sessionId: session_id,
          fromIndex: from_index,
          limit: limit ?? 40,
          includeToolDetails: include_tool_details,
        })

        if (!page) return { error: 'Conversation not found or not readable in this workspace.' }

        return {
          session_id: page.conversation.sessionId,
          title: page.conversation.title,
          created_at: page.conversation.createdAt.toISOString(),
          message_count: page.conversation.messageCount,
          ...(session_id === conversationId ? { is_current_conversation: true } : {}),
          turn_diagnostics: page.turnDiagnostics,
          transcript: page.lines.join('\n'),
          next_index: page.nextIndex,
        }
      },
    }),
    readShape,
  )

  return { list_recent_conversations, read_conversation }
}
