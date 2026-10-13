import { z } from 'zod'

import {
  createAgentThread,
  sendAgentThreadMessage,
  setAgentThreadParent,
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
const setParent = z
  .object({
    label: common.label,
    threadId: z.string().uuid(),
    parentThreadId: z
      .string()
      .uuid()
      .nullable()
      .describe('Conversation to nest the thread under; null stops nesting it.'),
  })
  .strict()

export function threadToolModule(): PreviewToolModule {
  return {
    definitions: [
      {
        name: 'create_thread',
        description:
          'Create and start a separate Nuphos conversation only when asked to delegate/background work. ' +
          'Inherits your current runtime and selected credentials, not transcript or approval bypass. ' +
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
        name: 'set_thread_parent',
        description:
          'Nest an existing Nuphos thread under another conversation in the sidebar, e.g. your own ' +
          'session_id to group threads you manage, or pass parentThreadId null to stop nesting it. ' +
          'Both must be conversations you own in this team, and the parent must not already be nested ' +
          'below the thread. Changes only the sidebar grouping, not runtime, credentials or messages.',
        inputSchema: toolInputJsonSchema(setParent),
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
      set_thread_parent: async (args) => {
        const parsed = setParent.safeParse(args)

        if (!parsed.success) return toolError(parsed.error.message)

        return toolResult(
          await setAgentThreadParent(ctx, parsed.data.threadId, parsed.data.parentThreadId),
        )
      },
    }),
  }
}
