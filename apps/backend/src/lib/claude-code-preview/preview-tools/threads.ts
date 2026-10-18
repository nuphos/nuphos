import { z } from 'zod'

import {
  createAgentThread,
  listThreadRuntimes,
  sendAgentThreadMessage,
  setAgentThreadArchived,
  setAgentThreadParent,
  updateThread,
} from '@/lib/agent/thread-bridge'
import { randomUUID } from 'node:crypto'

import { toolError, toolResult } from '@/lib/mcp/protocol'

import { publishPreviewFrame } from '../run-frame-bridge'

import { toolInputJsonSchema } from './ai-sdk-adapter'

import type {
  PreviewToolContext,
  PreviewToolModule,
  PublishPreviewFrame,
} from '../preview-tool-context'

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
const update = z
  .object({
    label: common.label,
    threadId: z.string().uuid(),
    fullAccess: z.boolean().optional().describe('true for Full Access, false for Auto Mode.'),
    runtimeId: z.string().trim().min(1).optional().describe('From list_agent_runtimes.'),
    grant: z
      .array(z.object({ provider: z.string().min(1), id: z.string().min(1) }).strict())
      .max(50)
      .optional()
      .describe('(provider, id) pairs from your own list_credentials to add to the thread.'),
  })
  .strict()
const archive = z
  .object({
    label: common.label,
    threadId: z.string().uuid(),
    archived: z.boolean().default(true).describe('false restores an archived conversation.'),
  })
  .strict()
const list = z.object({ label: common.label }).strict()

// A refusal is the answer the agent needs, so it gets the reason, as tools served
// through ai-sdk-adapter do, instead of the dispatcher's bare "Internal error".
function answer(work: Promise<unknown>) {
  return work.then(toolResult, (error: unknown) =>
    toolError(error instanceof Error ? error.message : String(error)),
  )
}

// The runtime hides nuphos-tools calls from the live stream, so the Desktop's
// thread badge only sees one when the tool publishes its own frames, as decisions do.
async function shown(
  publish: PublishPreviewFrame,
  ctx: PreviewToolContext,
  toolName: string,
  input: unknown,
  run: () => Promise<unknown>,
) {
  const toolCallId = `nuphos-${randomUUID()}`
  const emit = (frame: Record<string, unknown>) => publish(ctx, frame).catch(() => {})

  // The work starts only once the input frame is out, so its result never arrives first.
  await emit({ type: 'tool-input-available', toolCallId, toolName, input })
  try {
    const output = await run()

    await emit({ type: 'tool-output-available', toolCallId, output })

    return toolResult(output)
  } catch (error: unknown) {
    const errorText = error instanceof Error ? error.message : String(error)

    await emit({ type: 'tool-output-error', toolCallId, errorText })

    return toolError(errorText)
  }
}

export function threadToolModule(
  options: { publish?: PublishPreviewFrame } = {},
): PreviewToolModule {
  const publish = options.publish ?? publishPreviewFrame

  return {
    definitions: [
      {
        name: 'create_thread',
        description:
          'Start a Nuphos sub-agent: a separate Nuphos conversation. Use it only when asked for a sub-agent or to delegate/background work. ' +
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
          'The target keeps its own runtime and credential selection. status is "started" when an ' +
          'idle thread started a turn now, "queued" when a busy thread will run it as its own turn ' +
          'after the turns ahead of it; neither means the task is done. ' +
          'Use the Nuphos threadId from create_thread or session_id from list_recent_conversations. ' +
          'Do not send acknowledgement loops.',
        inputSchema: toolInputJsonSchema(send),
      },
      {
        name: 'archive_thread',
        description:
          'Archive a Nuphos conversation you own in this team, or restore it with archived=false. ' +
          'Use when its work is done or the user asks; the current conversation counts too. ' +
          'Archiving hides it and stops resource-event wakeups, but does not stop a running turn. ' +
          'Its sub-agent threads, recursively, are archived and restored with it; ' +
          'archived threads stop accepting send_message_to_thread. ' +
          'A new human message restores it. Use threadId from create_thread or session_id from ' +
          'list_recent_conversations.',
        inputSchema: toolInputJsonSchema(archive),
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
          'runs there. grant adds credentials or devices (provider "device") that this ' +
          "conversation has selected, as its list_credentials shows them, to the thread's " +
          "selection; it never removes any. A new thread already starts in this conversation's " +
          'mode, agent and selection.',
        inputSchema: toolInputJsonSchema(update),
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

        return shown(publish, ctx, 'create_thread', parsed.data, () =>
          createAgentThread(ctx, parsed.data.prompt, parsed.data.title),
        )
      },
      send_message_to_thread: async (args) => {
        const parsed = send.safeParse(args)

        if (!parsed.success) return toolError(parsed.error.message)

        return shown(publish, ctx, 'send_message_to_thread', parsed.data, () =>
          sendAgentThreadMessage(ctx, parsed.data.threadId, parsed.data.prompt),
        )
      },
      archive_thread: async (args) => {
        const parsed = archive.safeParse(args)

        if (!parsed.success) return toolError(parsed.error.message)

        return answer(setAgentThreadArchived(ctx, parsed.data.threadId, parsed.data.archived))
      },
      list_agent_runtimes: async (args) => {
        const parsed = list.safeParse(args)

        if (!parsed.success) return toolError(parsed.error.message)

        return answer(listThreadRuntimes(ctx))
      },
      update_thread: async (args) => {
        const parsed = update.safeParse(args)

        if (!parsed.success) return toolError(parsed.error.message)
        const { threadId, ...change } = parsed.data

        if (change.fullAccess === undefined && !change.runtimeId && !change.grant?.length)
          return toolError('Set fullAccess, runtimeId or grant.')

        return answer(updateThread(ctx, threadId, change))
      },
      set_thread_parent: async (args) => {
        const parsed = setParent.safeParse(args)

        if (!parsed.success) return toolError(parsed.error.message)

        return answer(setAgentThreadParent(ctx, parsed.data.threadId, parsed.data.parentThreadId))
      },
    }),
  }
}
