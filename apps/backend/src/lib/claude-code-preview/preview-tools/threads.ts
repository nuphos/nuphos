import { z } from 'zod'

import {
  createAgentThread,
  listThreadRuntimes,
  sendAgentThreadMessage,
  setAgentThreadArchived,
  setAgentThreadParent,
  updateThread,
} from '@/lib/agent/thread-bridge'
import { stopAgentThread } from '@/lib/agent/thread-stop'

import { toolError, toolResult } from '@/lib/mcp/protocol'

import { publishPreviewFrame } from '../run-frame-bridge'

import { presentedByRuntime, toolInputJsonSchema } from './ai-sdk-adapter'

import type { PreviewToolModule, PublishPreviewFrame } from '../preview-tool-context'

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
// The thread's model picker: values from its agent's catalog, refused with the choices.
const modelPick = {
  model: z.string().trim().min(1).max(500).optional().describe('Model id, e.g. claude-fable-5-1.'),
  effort: z.string().trim().min(1).max(100).optional().describe('Reasoning effort, e.g. high.'),
  fast: z.string().trim().min(1).max(100).optional().describe('Fast mode, e.g. on or off.'),
}
const runtimeId = z.string().trim().min(1).optional().describe('From list_agent_runtimes.')
const create = z
  .object({
    ...common,
    title: z.string().trim().min(1).max(160),
    runtimeId,
    requestId: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .optional()
      .describe(
        'Stable key for this delegation. Reuse the same key and prompt when retrying; use a new key for unrelated work.',
      ),
    ...modelPick,
    modelReason: z
      .string()
      .trim()
      .min(1)
      .max(300)
      .optional()
      .describe('Why this model and effort fit the work, in one sentence; shown to the person.'),
  })
  .strict()
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
const change = {
  label: common.label,
  fullAccess: z
    .boolean()
    .optional()
    .describe('true for Full Access, false for Auto Mode. Refused for a Task under a parent.'),
  runtimeId,
  ...modelPick,
}
const update = z
  .object({
    taskId: z.string().uuid().describe('A Task or Bot you own here, or your own session id.'),
    ...change,
  })
  .strict()
// The name update_task had until it was renamed; kept for one release.
const updateThreadAlias = z.object({ threadId: z.string().uuid(), ...change }).strict()
const archive = z
  .object({
    label: common.label,
    threadId: z.string().uuid(),
    archived: z.boolean().default(true).describe('false restores an archived conversation.'),
  })
  .strict()
const stop = z.object({ label: common.label, threadId: z.string().uuid() }).strict()
const list = z.object({ label: common.label }).strict()

// A refusal is the answer the agent needs, so it gets the reason, as tools served
// through ai-sdk-adapter do, instead of the dispatcher's bare "Internal error".
function answer(work: Promise<unknown>) {
  return work.then(toolResult, (error: unknown) =>
    toolError(error instanceof Error ? error.message : String(error)),
  )
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
          'It does not inherit your transcript. It always runs in the permission mode of the ' +
          'conversation at the top of yours. It runs on your agent, or on the ' +
          'one runtimeId names from list_agent_runtimes. ' +
          'It uses the credentials and computers of the conversation at the top of yours, ' +
          'always the same as yours, and changes when that selection changes. ' +
          "model, effort and fast set its model picker before its first turn; its agent's defaults otherwise. " +
          'Unless the person named a model for this work, choose them yourself from the models ' +
          'list_agent_runtimes shows for its agent: a lighter, cheaper model for simple or mechanical ' +
          'work, a stronger one for hard reasoning or risky changes. Say why in modelReason. ' +
          'The current chat stays available. Specify a completion condition and ask the worker to use ' +
          'report_task to report results or blockers. Supply requestId and reuse it with the same prompt on retries to avoid duplicate Tasks. Returns a Nuphos threadId (not a Codex internal ID). ' +
          'Only available for conversations owned by the current actor.',
        inputSchema: toolInputJsonSchema(create),
      },
      {
        name: 'send_message_to_thread',
        description:
          'Send work or a completion report to another Nuphos thread you own in this team. ' +
          'The target keeps its own runtime. status is "started" when an ' +
          'idle thread started a turn now, "queued" when a busy thread will run it as its own turn ' +
          'after the turns ahead of it; neither means the task is done. ' +
          'An archived target is restored when the message runs. ' +
          'Use the Nuphos threadId from create_thread or session_id from list_recent_conversations. ' +
          'Do not send acknowledgement loops.',
        inputSchema: toolInputJsonSchema(send),
      },
      {
        name: 'archive_thread',
        description:
          'Archive a Nuphos conversation you own in this team, or restore it with archived=false. ' +
          'Use when its work is done or the user asks; the current conversation counts too. ' +
          'Archiving hides it but does not stop a running turn. ' +
          'Its sub-agent threads, recursively, are archived and restored with it. ' +
          'Any new turn restores it: a human message, send_message_to_thread, or a bound ' +
          'resource or Trigger event. ' +
          'Use threadId from create_thread or session_id from ' +
          'list_recent_conversations.',
        inputSchema: toolInputJsonSchema(archive),
      },
      {
        name: 'stop_thread',
        description:
          'Stop the running turn of another Nuphos conversation you own in this team, the same ' +
          'as the Stop button in that conversation. Messages that agents queued for it with ' +
          'send_message_to_thread are dropped so they do not start another turn; messages people ' +
          'sent stay and run next. Its history stays. Use threadId from create_thread or ' +
          'session_id from list_recent_conversations.',
        inputSchema: toolInputJsonSchema(stop),
      },
      {
        name: 'list_agent_runtimes',
        description:
          "List the agents (runtimes) your threads can run on: the team's, and those on your Boxes and computers, with each one's readiness, " +
          'usage quota and the models it offers. Use it to pick a runtimeId or model for create_thread ' +
          "or update_thread, for example when a thread has hit its agent's usage limit. " +
          'Agents listed in sharesQuotaWith are signed in to the same account and run out ' +
          'together: moving to one of them does not get past a limit. One a thread cannot use says why in unavailable.',
        inputSchema: toolInputJsonSchema(list),
      },
      {
        name: 'update_task',
        description:
          'Change a Nuphos Task or Bot you own in this team, or yourself. fullAccess switches a ' +
          'conversation with no parent between Full Access (true) and Auto Mode (false); Full ' +
          'Access is allowed only while this conversation itself has Full Access, Auto Mode ' +
          "always. A thread under a parent always runs in its top conversation's mode, so " +
          'fullAccess is refused for it. runtimeId moves it, with ' +
          'its conversation history, to another agent from list_agent_runtimes ' +
          'that is ready; its next turn ' +
          "runs there. model, effort and fast set the Task's model picker for its " +
          'next turn, after any runtimeId move; a value its agent does not offer is refused with ' +
          'the choices. With your own session id as taskId, only model, effort and fast apply, ' +
          'from your next turn: this reply keeps its settings. Use it to move yourself to a ' +
          'lighter model for mechanical work or a stronger one for a hard step. ' +
          "A new Task already starts on this conversation's " +
          "agent unless create_thread named another. Its credentials and computers are always the top conversation's, " +
          'so there is nothing to grant.',
        inputSchema: toolInputJsonSchema(update),
      },
      {
        name: 'update_thread',
        description:
          'Former name of update_task, kept for one release; it takes threadId instead of taskId. Use update_task.',
        inputSchema: toolInputJsonSchema(updateThreadAlias),
      },
      {
        name: 'set_thread_parent',
        description:
          'Nest an existing Nuphos thread under another conversation in the sidebar, e.g. your own ' +
          'session_id to group threads you manage, or pass parentThreadId null to stop nesting it. ' +
          'Both must be conversations you own in this team, and the parent must not already be nested ' +
          'below the thread. Changes the grouping and, with it, whose credentials and computers the ' +
          'thread uses: the top conversation above it, or its own once no longer nested. ' +
          'Runtime and messages stay.',
        inputSchema: toolInputJsonSchema(setParent),
      },
    ],
    handlers: (ctx) => {
      const changeTask = (taskId: string, changed: Omit<z.infer<typeof update>, 'taskId'>) => {
        const { fullAccess, runtimeId: runtime, model, effort, fast } = changed

        if (fullAccess === undefined && !runtime && !model && !effort && !fast)
          return toolError('Set fullAccess, runtimeId, model, effort or fast.')

        return answer(updateThread(ctx, taskId, changed))
      }

      return {
        create_thread: async (args) => {
          const parsed = create.safeParse(args)

          if (!parsed.success) return toolError(parsed.error.message)

          return presentedByRuntime(publish, ctx, 'create_thread', parsed.data, () =>
            createAgentThread(ctx, parsed.data.prompt, parsed.data.title, parsed.data),
          )
        },
        send_message_to_thread: async (args) => {
          const parsed = send.safeParse(args)

          if (!parsed.success) return toolError(parsed.error.message)

          return presentedByRuntime(publish, ctx, 'send_message_to_thread', parsed.data, () =>
            sendAgentThreadMessage(ctx, parsed.data.threadId, parsed.data.prompt),
          )
        },
        archive_thread: async (args) => {
          const parsed = archive.safeParse(args)

          if (!parsed.success) return toolError(parsed.error.message)

          return answer(setAgentThreadArchived(ctx, parsed.data.threadId, parsed.data.archived))
        },
        stop_thread: async (args) => {
          const parsed = stop.safeParse(args)

          if (!parsed.success) return toolError(parsed.error.message)

          return answer(stopAgentThread(ctx, parsed.data.threadId))
        },
        list_agent_runtimes: async (args) => {
          const parsed = list.safeParse(args)

          if (!parsed.success) return toolError(parsed.error.message)

          return answer(listThreadRuntimes(ctx))
        },
        update_task: async (args) => {
          const parsed = update.safeParse(args)

          if (!parsed.success) return toolError(parsed.error.message)
          const { taskId, ...changed } = parsed.data

          return changeTask(taskId, changed)
        },
        update_thread: async (args) => {
          const parsed = updateThreadAlias.safeParse(args)

          if (!parsed.success) return toolError(parsed.error.message)
          const { threadId, ...changed } = parsed.data

          return changeTask(threadId, changed)
        },
        set_thread_parent: async (args) => {
          const parsed = setParent.safeParse(args)

          if (!parsed.success) return toolError(parsed.error.message)

          return answer(setAgentThreadParent(ctx, parsed.data.threadId, parsed.data.parentThreadId))
        },
      }
    },
  }
}
