import { z } from 'zod'

import {
  createAgentThread,
  sendAgentThreadMessage,
  listThreadRuntimes,
  updateThread,
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
const update = z
  .object({
    label: common.label,
    threadId: z.string().uuid(),
    fullAccess: z.boolean().optional().describe('true for Full Access, false for Auto Mode.'),
    runtimeId: z.string().trim().min(1).optional().describe('From list_agent_runtimes.'),
  })
  .strict()
const list = z.object({ label: common.label }).strict()

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
        name: 'list_agent_runtimes',
        description:
          "List the team's agents (runtimes) your threads can run on, with each one's readiness and " +
          'usage quota. Use it to pick a runtimeId for update_thread, for example when a thread ' +
          "has hit its agent's usage limit.",
        inputSchema: toolInputJsonSchema(list),
      },
      {
        name: 'update_thread',
        description:
          'Change a thread this conversation created with create_thread. fullAccess switches it ' +
          'between Full Access (true) and Auto Mode (false); Full Access is allowed only while ' +
          'this conversation itself has Full Access, Auto Mode always. runtimeId moves it, with ' +
          "its conversation history, to another of the team's agents from list_agent_runtimes " +
          "(never to someone's computer); its next turn " +
          "runs there. A new thread already starts in this conversation's mode and agent.",
        inputSchema: toolInputJsonSchema(update),
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
      list_agent_runtimes: async (args) => {
        const parsed = list.safeParse(args)

        if (!parsed.success) return toolError(parsed.error.message)

        return toolResult(await listThreadRuntimes(ctx))
      },
      update_thread: async (args) => {
        const parsed = update.safeParse(args)

        if (!parsed.success) return toolError(parsed.error.message)
        const { threadId, ...change } = parsed.data

        if (change.fullAccess === undefined && change.runtimeId === undefined)
          return toolError('Set fullAccess, runtimeId, or both.')

        return toolResult(await updateThread(ctx, threadId, change))
      },
    }),
  }
}
