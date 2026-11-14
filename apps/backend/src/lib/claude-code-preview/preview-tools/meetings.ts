import { z } from 'zod'

import { config } from '@/config'
import { getConversationBySessionId } from '@/lib/agent/db'
import { getTeamMembership } from '@/lib/identity'
import { joinMeeting, leaveMeetingChannel } from '@/lib/meetings/meetings'
import { toolError, toolResult } from '@/lib/mcp/protocol'

import { toolInputJsonSchema } from './ai-sdk-adapter'

import type { PreviewToolModule } from '../preview-tool-context'

const label = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .describe('Short step label in the conversation language.')
const join = z
  .object({
    label,
    url: z.string().url().describe('The meeting link, e.g. https://meet.google.com/abc-defg-hij.'),
  })
  .strict()
const leave = z
  .object({ label, channelId: z.string().uuid().describe('The channelId meeting_join returned.') })
  .strict()

// A refusal is the answer the agent needs, so it gets the reason.
function answer(work: Promise<unknown>) {
  return work.then(toolResult, (error: unknown) =>
    toolError(error instanceof Error ? error.message : String(error)),
  )
}

/** Off unless this server has Recall.ai set up. */
export function meetingToolModule(): PreviewToolModule {
  if (!config.meetings.recall) return { definitions: [], handlers: () => ({}) }

  return {
    definitions: [
      {
        name: 'meeting_join',
        description:
          'Join a Google Meet, Zoom or Teams call as yourself (under this conversation’s name) ' +
          'to listen and type in its chat; you never speak aloud. Use it when the user asks ' +
          'you to join a meeting. It opens a channel for the call: what people say there ' +
          'reaches you as channel messages, and your channel_post in it goes to the meeting ' +
          'chat. The host may have to admit you. Call meeting_leave when asked to leave.',
        inputSchema: toolInputJsonSchema(join),
      },
      {
        name: 'meeting_leave',
        description: 'Leave a call you joined with meeting_join.',
        inputSchema: toolInputJsonSchema(leave),
      },
    ],
    handlers: (ctx) => ({
      meeting_join: async (args) => {
        const parsed = join.safeParse(args)

        if (!parsed.success) return toolError(parsed.error.message)

        return answer(
          (async () => {
            const self = await getConversationBySessionId(ctx.sessionId)

            if (!self || !(await getTeamMembership(self.userId, ctx.teamId)))
              throw new Error('This agent’s owner is no longer on the team.')

            return joinMeeting(self, ctx.teamId, parsed.data.url)
          })(),
        )
      },
      meeting_leave: async (args) => {
        const parsed = leave.safeParse(args)

        if (!parsed.success) return toolError(parsed.error.message)

        return answer(
          leaveMeetingChannel(parsed.data.channelId, ctx.sessionId).then(() => ({ left: true })),
        )
      },
    }),
  }
}
