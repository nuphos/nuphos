import { z } from 'zod'

import type { ApiOperation } from './registry'

const value = z.object({
  value: z.string().describe('The id the agent uses, e.g. `gpt-6.2-sol` or `low`.'),
  name: z.string().optional().describe('What the picker called it then, when it differs.'),
})
const runtime = z.object({
  id: z
    .string()
    .optional()
    .describe('The agent runtime id; absent on moves recorded before ids were.'),
  label: z.string().optional(),
  provider: z.string().optional().describe('`claude-code`, `codex`, …'),
})
const diff = <T extends z.ZodTypeAny>(schema: T) =>
  z
    .object({
      from: schema.optional().describe('Absent: unset, so the agent used its default.'),
      to: schema.optional().describe('Absent: unset, so the agent uses its default.'),
    })
    .optional()

const settingsChangeSchema = z.object({
  at: z.string().describe('When it changed (ISO 8601).'),
  actor: z
    .object({
      type: z
        .enum(['user', 'agent', 'system'])
        .describe('`agent`: an agent session acting for `userId`. `system`: no one asked for it.'),
      userId: z.string().optional(),
      name: z.string().optional(),
      agentSessionId: z.string().optional(),
      agentTitle: z.string().optional(),
    })
    .describe('Who made the change.'),
  via: z
    .enum([
      'picker',
      'new_chat',
      'update_thread',
      'create_thread',
      'mcp_update',
      'trigger',
      'mcp_ask',
      'runtime_move',
      'runtime_fallback',
      'placement',
      'session_start',
      'runtime_reported',
      'session_lost',
    ])
    .describe(
      'Where it came from. `session_start`: the settings the agent confirmed when it opened a ' +
        'session, its own defaults included. `runtime_reported`: the agent changed a setting ' +
        'itself between turns. `placement`: the first agent a conversation ran on.',
    ),
  client: z
    .string()
    .optional()
    .describe(
      'The app that sent it: `desktop`, `ios`, `android`, `web`, `cli`, `api`, or an MCP client name.',
    ),
  reason: z.enum(['quota', 'offline', 'failure']).optional().describe('Why a fallback moved it.'),
  retrying: z.boolean().optional(),
  runtime: diff(runtime),
  model: diff(value),
  effort: diff(value),
  fast: diff(value),
  text: z.string().optional().describe('The change as one plain sentence.'),
})

export const conversationSettingsHistoryResponseSchema = z.object({
  changes: z.array(settingsChangeSchema).describe('Oldest first. Records are never removed.'),
})

export const conversationSettingsApiOperations = [
  {
    operationId: 'agent.conversationSettingsHistory.list',
    method: 'get',
    path: '/agent/conversations/{sessionId}/settings-history',
    tags: ['Agent conversations'],
    summary: 'List a conversation’s settings changes',
    description:
      'Every change of the agent runtime, model, effort and fast mode of a conversation (a Task, ' +
      'a Bot, or a thread): when, from and to what, by whom, and from where. Automatic changes ' +
      'are included. Readable by anyone who can read the conversation.',
    auth: 'bearer',
    pathSchema: z.object({ sessionId: z.string().describe('The conversation id.') }),
    querySchema: z.object({ teamId: z.string().optional() }),
    responseSchema: conversationSettingsHistoryResponseSchema,
  },
] as const satisfies readonly ApiOperation[]
