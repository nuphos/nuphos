import { z } from 'zod'

import type { ApiOperation } from './registry'

const configSchema = z
  .object({
    name: z.string().optional(),
    triggerType: z.string().optional().describe('`cron` or `webhook`.'),
    cronExpression: z.string().optional(),
    timeZone: z.string().optional(),
    targetSessionId: z.string().optional().describe('The Task it runs in.'),
    messageTemplate: z.string().optional(),
    enabled: z.boolean().optional(),
    expiresAt: z.string().optional(),
    minIntervalSeconds: z.number().optional(),
    payloadFilters: z.unknown().optional(),
    credentialMode: z.string().optional(),
    executionCredentialAccess: z.unknown().optional(),
    source: z.string().optional(),
    sourceContext: z.object({ sessionId: z.string().optional() }).optional(),
  })
  .describe('What the Trigger ran with. Its webhook secret is never recorded.')

const triggerChangeSchema = z.object({
  at: z.string().describe('When it changed (ISO 8601).'),
  triggerId: z.string(),
  teamId: z.string().optional(),
  userId: z.string().describe('The owner of the Trigger’s Task.'),
  targetSessionId: z.string().optional(),
  action: z.enum(['created', 'updated', 'deleted']),
  actor: z
    .object({
      type: z
        .enum(['user', 'agent', 'system'])
        .describe('`agent`: an agent session acting for `userId`. `system`: Nuphos itself.'),
      userId: z.string().optional(),
      agentSessionId: z.string().optional(),
    })
    .describe('Who made the change.'),
  via: z
    .enum(['request', 'bot_import', 'rollback', 'expiry', 'authorization', 'failed_runs'])
    .describe(
      '`request`: an API call, from an app, an agent or a script. `rollback`: Nuphos undid a ' +
        'write the scheduler could not follow. `expiry`, `authorization`, `failed_runs`: Nuphos ' +
        'paused it because it expired, could no longer run as its owner, or kept failing.',
    ),
  client: z.string().optional().describe('The app that sent the request, when it said.'),
  reason: z.string().optional().describe('Why Nuphos changed it.'),
  before: configSchema.optional().describe('Absent when it was created.'),
  after: configSchema.optional().describe('Absent when it was deleted.'),
})

export const triggerHistoryResponseSchema = z.object({
  changes: z.array(triggerChangeSchema).describe('Newest first, at most 200. Never removed.'),
})

export const triggerHistoryApiOperations = [
  {
    operationId: 'agent.triggerHistory.list',
    method: 'get',
    path: '/agent/triggers/history',
    tags: ['Triggers'],
    summary: 'List who created, changed or deleted Triggers',
    description:
      'Every create, change, pause and delete of a team’s Triggers, or of your personal ones ' +
      'without `teamId`, deleted Triggers included: when, by whom, from where, and what it ran ' +
      'with before and after. A record is readable by whoever may read the Trigger’s Task.',
    auth: 'bearer',
    querySchema: z.object({
      teamId: z.string().optional(),
      triggerId: z.string().optional().describe('Only this Trigger’s records.'),
    }),
    responseSchema: triggerHistoryResponseSchema,
  },
] as const satisfies readonly ApiOperation[]
