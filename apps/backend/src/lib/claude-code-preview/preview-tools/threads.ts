import { z } from 'zod'

import {
  createAgentThread,
  sendAgentThreadMessage,
  setThreadFullAccess,
} from '@/lib/agent/thread-bridge'
import { toolError, toolResult } from '@/lib/mcp/protocol'

import { toolInputJsonSchema } from './ai-sdk-adapter'

import type { PreviewToolModule } from '../preview-tool-context'

const common = {
  label: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe('Short step label in the conversation language.'),
  prompt: z
    .string()
    .trim()
    .min(1)
    .max(3000)
    .describe('Bounded task or result; never include credentials.'),
}
const create = z.object({ ...common, title: z.string().trim().min(1).max(160) }).strict()
const send = z.object({ ...common, threadId: z.string().uuid() }).strict()
const mode = z
  .object({
    label: common.label,
    threadId: z.string().uuid(),
    fullAccess: z.boolean().describe('true for Full Access, false for Auto Mode.'),
  })
  .strict()

export function threadToolModule(): PreviewToolModule {
  return {
    definitions: [
      {
        name: 'create_thread',
        description:
          'Create and start a separate Nuphos conversation only when asked to delegate/background work. ' +
          'Inherits your current runtime, selected credentials and permission mode, not your transcript. ' +
          'The current chat stays available. Specify a completion condition and ask the worker to use ' +
          'send_message_to_thread to report back. Returns a Nuphos threadId (not a Codex internal ID). ' +
          'Only available for conversations owned by the current actor.',
        inputSchema: toolInputJsonSchema(create),
      },
      {
        name: 'send_message_to_thread',
        description:
          'Send work or a completion report to another Nuphos thread you own in this team. ' +
          'The target keeps its own runtime and credential selection. An idle thread starts a turn; ' +
          'a busy thread receives the message through its pending-message queue. ' +
          'Use the Nuphos threadId from create_thread or session_id from list_recent_conversations. ' +
          'A queued receipt is not proof of task completion. Do not send acknowledgement loops.',
        inputSchema: toolInputJsonSchema(send),
      },
      {
        name: 'set_thread_permission_mode',
        description:
          'Switch a thread this conversation created with create_thread between Full Access ' +
          '(fullAccess: true) and Auto Mode (false). Full Access is allowed only while this ' +
          'conversation itself has Full Access; Auto Mode is always allowed. ' +
          "A new thread already starts in this conversation's mode, so use this only to change it.",
        inputSchema: toolInputJsonSchema(mode),
      },
    ],
    handlers: (ctx) => ({
      create_thread: async (args) => {
        const parsed = create.safeParse(args)

        if (!parsed.success) return toolError(parsed.error.message)

        return toolResult(await createAgentThread(ctx, parsed.data.prompt, parsed.data.title))
      },
      send_message_to_thread: async (args) => {
        const parsed = send.safeParse(args)

        if (!parsed.success) return toolError(parsed.error.message)

        return toolResult(
          await sendAgentThreadMessage(ctx, parsed.data.threadId, parsed.data.prompt),
        )
      },
      set_thread_permission_mode: async (args) => {
        const parsed = mode.safeParse(args)

        if (!parsed.success) return toolError(parsed.error.message)

        return toolResult(
          await setThreadFullAccess(ctx, parsed.data.threadId, parsed.data.fullAccess),
        )
      },
    }),
  }
}
