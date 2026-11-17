import { tool } from 'ai'
import { z } from 'zod'

import { BOT_AVATARS } from './bot-avatars'
import { getConversation, updateBotSelf } from './db'
import { withLabel } from './tools-skilled/labeling'

const UPDATE_SELF_DESCRIPTION =
  'Change who you are, when this conversation is a Bot: your name, your face, your standing instructions, your model, or your reasoning effort. ' +
  'People see the new name and face in the sidebar and titlebar; instructions, model and effort apply from your next turn, so the current reply keeps its settings. ' +
  'Model and effort must be offered by your current agent; an invalid choice returns its available options. ' +
  'Use it when the person you work for tells you what you are for, what to call you, how to behave, or asks you to change any of that — draft the instructions from the conversation, in the second person, and send the whole new text. ' +
  'Pass only the fields that change. Only the owner of a Bot can change it, and a Task (a conversation without a face) cannot use it.'

const NOT_OWN_BOT =
  'This conversation is not a Bot owned by the person you are working for, so it cannot change itself.'

const updateSelfShape = {
  name: z.string().trim().min(1).max(120).optional().describe('Your new name, 1–120 characters.'),
  avatar: z.enum(BOT_AVATARS).optional().describe('Your new face, by name.'),
  instructions: z
    .string()
    .trim()
    .max(8000)
    .optional()
    .describe('Your complete standing instructions, replacing the old ones. Empty clears them.'),
  model: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .optional()
    .describe('Model id offered by your current agent, applied from your next turn.'),
  effort: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe('Reasoning effort offered for the model, applied from your next turn.'),
}

export function updateSelfTool(userId: string, conversationId: string, teamId: string) {
  return withLabel(
    tool({
      description: UPDATE_SELF_DESCRIPTION,
      inputSchema: z.object(updateSelfShape),
      execute: async ({ name, avatar, instructions, model, effort }) => {
        const update = {
          ...(name === undefined ? {} : { title: name }),
          ...(avatar === undefined ? {} : { avatar }),
          ...(instructions === undefined ? {} : { instructions }),
        }
        const modelPick = {
          ...(model === undefined ? {} : { model }),
          ...(effort === undefined ? {} : { effort }),
        }
        const changed = Object.keys(update).length + Object.keys(modelPick).length

        if (changed === 0) return { error: 'Pass at least one field to change.' }
        let sessionConfigUpdate = {}

        if (Object.keys(modelPick).length > 0) {
          const conversation = await getConversation(conversationId, userId, teamId)

          if (!conversation || conversation.avatar === undefined) return { error: NOT_OWN_BOT }
          try {
            // Loaded on demand so this tool module does not pull the runtime session
            // stack in at import time; the tool only needs it when model settings change.
            const { botSessionConfigUpdate } =
              await import('@/lib/claude-code-preview/bot-session-config')

            sessionConfigUpdate = await botSessionConfigUpdate(conversation, modelPick, userId)
          } catch (error) {
            return {
              error:
                error instanceof Error ? error.message : 'The model settings could not be changed.',
            }
          }
        }
        if (
          !(await updateBotSelf(conversationId, userId, teamId, {
            ...update,
            ...sessionConfigUpdate,
          }))
        ) {
          return { error: NOT_OWN_BOT }
        }

        return {
          updated: [...Object.keys(update), ...Object.keys(modelPick)],
          ...(Object.keys(modelPick).length > 0 ? { model: modelPick, applies: 'next_turn' } : {}),
        }
      },
    }),
    updateSelfShape,
  )
}
