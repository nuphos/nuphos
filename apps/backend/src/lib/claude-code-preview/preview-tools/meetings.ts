import { z } from 'zod'

import { config } from '@/config'
import { toolError, toolResult } from '@/lib/mcp/protocol'
import { chatInMeeting, joinMeeting, leaveMeetingTask } from '@/lib/meetings/meetings'

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
    brief: z
      .string()
      .trim()
      .min(1)
      .max(3000)
      .optional()
      .describe('What to do in the call and what to know for it; never include credentials.'),
  })
  .strict()
const chat = z.object({ label, text: z.string().trim().min(1).max(4096) }).strict()
const leave = z
  .object({
    label,
    threadId: z
      .string()
      .uuid()
      .optional()
      .describe("The threadId meeting_join returned; omit inside the meeting's own Task."),
  })
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
          'Join a Google Meet, Zoom or Teams call as your Bot (a Task joins as the Bot above it). ' +
          'Use it when the user asks you to join a meeting. It starts a Task under your Bot for ' +
          'the call: that Task hears what people say and types in the meeting chat, never aloud, ' +
          'and keeps the transcript once the call is over. It does not see this conversation, so ' +
          'put what it should do there in brief; send_message_to_thread reaches it later. The ' +
          'host may have to admit it. Call meeting_leave when asked to leave.',
        inputSchema: toolInputJsonSchema(join),
      },
      {
        name: 'meeting_chat',
        description:
          'Type in the chat of the call this Task is in. Only the Task meeting_join started has one.',
        inputSchema: toolInputJsonSchema(chat),
      },
      {
        name: 'meeting_leave',
        description: 'Leave a call joined with meeting_join. Its Task stays, with the transcript.',
        inputSchema: toolInputJsonSchema(leave),
      },
    ],
    handlers: (ctx) => ({
      meeting_join: async (args) => {
        const parsed = join.safeParse(args)

        if (!parsed.success) return toolError(parsed.error.message)

        return answer(joinMeeting(ctx, parsed.data.url, parsed.data.brief))
      },
      meeting_chat: async (args) => {
        const parsed = chat.safeParse(args)

        if (!parsed.success) return toolError(parsed.error.message)

        return answer(chatInMeeting(ctx, parsed.data.text).then(() => ({ sent: true })))
      },
      meeting_leave: async (args) => {
        const parsed = leave.safeParse(args)

        if (!parsed.success) return toolError(parsed.error.message)

        return answer(leaveMeetingTask(ctx, parsed.data.threadId).then(() => ({ left: true })))
      },
    }),
  }
}
