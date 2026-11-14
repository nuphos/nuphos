import { tool } from 'ai'
import { z } from 'zod'

import {
  getConversationBySessionId,
  getConversations,
  getConversationTranscriptForAgent,
  liveTurnTranscriptLine,
  updateBotSelf,
} from './db'
import { getSessionBypass } from './auto-mode/store'
import { BOT_AVATARS } from './bot-avatars'
import { createBot } from './bots'
import { getLiveTurn } from './live-turn'
import { renameConversationTool } from './tools-rename'
import { withLabel } from './tools-skilled/labeling'

const LIST_DESCRIPTION =
  'List the most recent conversations in this workspace (newest first), optionally filtered by a substring of their title or first message. ' +
  'Pages with cursor — pass the returned next_cursor to continue. ' +
  'Use it when the user refers to an earlier conversation — "what did we decide last time", "the chat from this morning about billing", "that cluster we set up" — to find it by title, topic or recency before asking them to repeat themselves, then read_conversation to read it. ' +
  'Set bots to list only Bots, however long ago they were active: the way to find another Bot to message with send_message_to_thread.'

const READ_DESCRIPTION =
  "Read one conversation's transcript in compact form: one line per message (`#index role: text`), tool calls summarized as `[tool: name]`. " +
  'A Nuphos session link (`/teams/<team>/agent/<session_id>`) in a message names a conversation; pass its last segment as session_id. ' +
  'Pages by message index — pass the returned next_index to continue. Read only the window you need. ' +
  'A turn still running is the last line of the last page, marked in progress with its start and last update times, and returned in in_progress; once it ends it is replaced by the stored message. ' +
  'Turn termination records are returned separately in turn_diagnostics, even when transcript text is truncated; timestamps describe backend observations and missing fields were not recorded. ' +
  'Tool inputs/outputs are omitted by default to keep the transcript small; set include_tool_details only when the exact command or result matters.'

const UPDATE_SELF_DESCRIPTION =
  'Change who you are, when this conversation is a Bot: your name, your face, or your standing instructions. ' +
  'People see the new name and face in the sidebar and titlebar; the instructions apply from your next turn. ' +
  'Use it when the person you work for tells you what you are for, what to call you, how to behave, or asks you to change any of that — draft the instructions from the conversation, in the second person, and send the whole new text. ' +
  'Pass only the fields that change. Only the owner of a Bot can change it, and a Task (a conversation without a face) cannot use it.'

const CREATE_BOT_DESCRIPTION =
  'Create a new Bot: a persistent agent with its own name, face and standing instructions, as "+ New Bot" does. ' +
  'Use it only when the person you work for explicitly asks for a new Bot; to delegate or background work, use create_thread instead. ' +
  'The Bot belongs to that person and is their 1:1 chat with it; it starts idle on your own agent and computer, in your own permission mode. ' +
  'Pass instructions in the second person, drafted from what they asked for. Returns its threadId, for update_thread and send_message_to_thread. ' +
  'The chat shows the new Bot as a link people can open, so do not paste its URL or id in your reply.'

function conversationSummary(
  c: {
    sessionId: string
    title: string
    createdAt: Date
    lastActiveAt: Date
    messageCount: number
    archivedAt?: Date
    userId: string
    parentSessionId?: string
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
    ...(c.parentSessionId ? { parent_session_id: c.parentSessionId } : {}),
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
    children: z
      .boolean()
      .optional()
      .describe("true lists only this conversation's sub-agents (threads nested under it)."),
    bots: z.boolean().optional().describe('true lists only Bots (conversations with a face).'),
  }
  const list_recent_conversations = withLabel(
    tool({
      description: LIST_DESCRIPTION,
      inputSchema: z.object(listShape),
      execute: async ({ limit, search, scope, cursor, children, bots }) => {
        const { conversations, nextCursor } = await getConversations(userId, {
          teamId,
          limit: limit ?? 15,
          search,
          // Sub-agents are the user's own threads, so children stays owner-scoped.
          scope: children ? 'mine' : (scope ?? 'mine'),
          cursor,
          bots,
          ...(children ? { parentSessionId: conversationId } : {}),
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
        const running =
          page.nextIndex === null
            ? await getLiveTurn(page.conversation.userId, page.conversation.sessionId)
            : null
        // The final message is stored a moment before the run's frames say
        // so; an assistant message stored since the turn began is that one.
        const live =
          running?.startedAt &&
          page.lastAssistantAt &&
          page.lastAssistantAt.getTime() >= Date.parse(running.startedAt)
            ? null
            : running
        const lines = live
          ? [
              ...page.lines,
              liveTurnTranscriptLine(page.conversation.messageCount, live, {
                includeToolDetails: include_tool_details,
              }),
            ]
          : page.lines

        return {
          session_id: page.conversation.sessionId,
          title: page.conversation.title,
          created_at: page.conversation.createdAt.toISOString(),
          message_count: page.conversation.messageCount,
          ...(session_id === conversationId ? { is_current_conversation: true } : {}),
          turn_diagnostics: page.turnDiagnostics,
          ...(live
            ? {
                in_progress: {
                  index: page.conversation.messageCount,
                  started_at: live.startedAt,
                  last_update_at: live.updatedAt,
                },
              }
            : {}),
          transcript: lines.join('\n'),
          next_index: page.nextIndex,
        }
      },
    }),
    readShape,
  )

  const updateSelfShape = {
    name: z.string().trim().min(1).max(120).optional().describe('Your new name, 1–120 characters.'),
    avatar: z.enum(BOT_AVATARS).optional().describe('Your new face, by name.'),
    instructions: z
      .string()
      .trim()
      .max(8000)
      .optional()
      .describe('Your complete standing instructions, replacing the old ones. Empty clears them.'),
  }
  const update_self = withLabel(
    tool({
      description: UPDATE_SELF_DESCRIPTION,
      inputSchema: z.object(updateSelfShape),
      execute: async ({ name, avatar, instructions }) => {
        const update = {
          ...(name === undefined ? {} : { title: name }),
          ...(avatar === undefined ? {} : { avatar }),
          ...(instructions === undefined ? {} : { instructions }),
        }

        if (Object.keys(update).length === 0) return { error: 'Pass at least one field to change.' }
        if (!(await updateBotSelf(conversationId, userId, teamId, update))) {
          return {
            error:
              'This conversation is not a Bot owned by the person you are working for, so it cannot change itself.',
          }
        }

        return { updated: Object.keys(update) }
      },
    }),
    updateSelfShape,
  )

  const createBotShape = {
    name: z.string().trim().min(1).max(120).describe('Its name, 1–120 characters.'),
    avatar: z.enum(BOT_AVATARS).optional().describe('Its face, by name; one is picked otherwise.'),
    instructions: z
      .string()
      .trim()
      .max(8000)
      .optional()
      .describe('Its standing instructions, in the second person.'),
  }
  const create_bot = withLabel(
    tool({
      description: CREATE_BOT_DESCRIPTION,
      inputSchema: z.object(createBotShape),
      execute: async ({ name, avatar, instructions }) => {
        // Never more access than the caller has, as create_thread does.
        const bypass = await getSessionBypass(conversationId, userId)
        const caller = await getConversationBySessionId(conversationId)
        // On the caller's agent and computer, as create_thread; a teammate's runtime is not theirs to use.
        const runtime =
          caller?.userId === userId && caller.teamId === teamId
            ? {
                agentRuntime: caller.agentRuntime,
                runtimeId: caller.runtimeId,
                runtimeLabel: caller.runtimeLabel,
              }
            : {}
        const bot = await createBot(userId, teamId, bypass, { title: name, avatar, ...runtime })
        const saved =
          !instructions || (await updateBotSelf(bot.sessionId, userId, teamId, { instructions }))

        return {
          threadId: bot.sessionId,
          name: bot.title,
          avatar: bot.avatar,
          full_access: bypass,
          ...(saved ? {} : { error: 'The Bot was created, but its instructions were not saved.' }),
        }
      },
    }),
    createBotShape,
  )

  return {
    list_recent_conversations,
    read_conversation,
    rename_conversation: renameConversationTool(userId, conversationId, teamId),
    update_self,
    create_bot,
  }
}
