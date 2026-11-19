import { tool } from 'ai'
import { z } from 'zod'

import { getConversationBySessionId, renameConversation, updateConversationTitle } from './db'
import { isUnnamedTask } from './title-fallback'
import { withLabel } from './tools-skilled/labeling'

const RENAME_DESCRIPTION =
  "Set a conversation's title, as if the user renamed it in the sidebar. Defaults to the current conversation. " +
  'Use it only when the user asks to rename a conversation, or to name this task when the system prompt says it still has no name. ' +
  'Only conversations the user owns in this workspace can be renamed; the new title is kept over any generated one.'

const renameShape = {
  title: z.string().trim().min(1).max(120).describe('New title, 1–120 characters.'),
  session_id: z
    .string()
    .min(1)
    .max(128)
    .optional()
    .describe('Conversation to rename (default: the current conversation).'),
  only_if_unnamed: z
    .boolean()
    .optional()
    .describe(
      'Name the current conversation only if nobody has renamed it, so a name the user chose is kept. ' +
        'Use it when naming a task yourself.',
    ),
}

export function renameConversationTool(userId: string, conversationId: string, teamId: string) {
  return withLabel(
    tool({
      description: RENAME_DESCRIPTION,
      inputSchema: z.object(renameShape),
      execute: async ({ title, session_id, only_if_unnamed }) => {
        // Naming a task: never over a name a person gave it, and it stays open to theirs.
        if (only_if_unnamed) {
          const current = await getConversationBySessionId(conversationId)

          return current &&
            isUnnamedTask(current) &&
            (await updateConversationTitle(conversationId, userId, title))
            ? { session_id: conversationId, title }
            : { session_id: conversationId, kept: 'It already has a name someone chose.' }
        }
        const sessionId = session_id ?? conversationId

        if (!(await renameConversation(sessionId, userId, teamId, title))) {
          return { error: 'Conversation not found or not owned by the user in this workspace.' }
        }

        return { session_id: sessionId, title }
      },
    }),
    renameShape,
  )
}
