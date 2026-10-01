import { tool } from 'ai'
import { z } from 'zod'

import { CRON_TIME_ZONE, nextCronRuns } from '@/lib/cron'

import {
  MONITORING_WORKFLOW_TOOL_GUIDANCE,
  pendingWebhookProviderWiring,
} from './monitoring-workflow'
import { createTriggerGroupTools } from './tools-triggers-group'
import {
  label,
  monitoringIdentitySchema,
  run,
  slackDestinationSchema,
  webhookUrlFor,
} from './tools-triggers-shared'
import {
  createTrigger,
  deleteTrigger,
  listTriggers,
  testFireTrigger,
  updateTrigger,
} from './trigger-service'

import type { AgentSessionOrigin } from './tools-triggers-shared'

export type { AgentSessionOrigin } from './tools-triggers-shared'

export function createTriggerTools(
  userId: string,
  sessionId: string,
  teamId: string | null | undefined,
  origin: AgentSessionOrigin,
) {
  // One actor context for every trigger mutation this session performs, so a
  // rebind captures the same approved credential scope the session runs with.
  const scope = { userId, teamId: teamId ?? undefined, sessionId }

  const trigger_create = tool({
    description:
      'Create an agent trigger that fires a NEW agent conversation on a schedule (cron) or when an external system calls a webhook. ' +
      'Use when the user asks for recurring work ("every weekday at 9 summarize open PRs") or alert-driven follow-ups (Grafana/Linear/Vercel webhooks). ' +
      'Translate natural-language schedules into a 5-field cron expression yourself; cron expressions are ALWAYS evaluated in UTC, so convert the local time the user means into UTC when writing one (ask for their timezone if unknown). Confirm the schedule with the user in plain words, stating both the UTC time and their local time, before creating; afterwards restate the returned nextRuns (UTC instants) in their timezone. ' +
      'For webhook triggers the result includes webhookUrl and webhookSecret (sender passes it as the X-Webhook-Secret header, or appended to the URL as ?secret=... for senders that cannot set custom headers). This is the ONLY time the secret is returned — relay it once or use it directly to configure the sending system; never re-paste it later. ' +
      `${MONITORING_WORKFLOW_TOOL_GUIDANCE} ` +
      'Do not poll unless the provider cannot send webhooks; then fall back to a cron trigger whose template checks the provider and acts only when something is firing. ' +
      'SLACK DESTINATIONS: Before creating a Slack trigger, call slack_list_destinations. Set incidentMode=true AND persist the user-approved exact choice in slackDestination; this server-owned field is the authorization boundary used by slack_post, while messageTemplate only describes the action. Use dm_self only when explicitly chosen and available; for a channel use its stable channelId. Never guess. If the user chose Nuphos, omit both fields and do not call slack_post. ' +
      'The messageTemplate is sent to an agent session on each fire; incidentMode reuses the open incident conversation. {{trigger.id}} / {{trigger.name}} / {{trigger.firedAt}} / {{trigger.lifecycle}} / {{trigger.hasOpenIncident}} are available, plus {{payload.*}} for webhook bodies. ' +
      'DUPLICATES: before creating, call trigger_list and check whether the user already has a trigger that is essentially the SAME recurring task (it may differ in schedule, wording, or name). If one does, do not silently add a near-duplicate — tell the user it exists and ask whether to modify that one (trigger_update) or add a separate new one, then act on their answer. If nothing similar exists, or the user already asked for a separate/new one, just create it — do not ask again. Do not mention this check to the user; speak only in plain terms about their triggers.',
    inputSchema: z.object({
      label,
      name: z.string().min(1).max(100).describe('Short trigger name shown in the Triggers UI.'),
      triggerType: z.enum(['cron', 'webhook']),
      cronExpression: z
        .string()
        .optional()
        .describe('Required for cron triggers: 5-field cron expression, e.g. "0 9 * * 1-5" (UTC).'),
      messageTemplate: z
        .string()
        .min(1)
        .describe(
          'Instruction sent to the agent on each fire. Write it self-contained; incidentMode can continue the open incident conversation, but the first delivery has no prior context.',
        ),
      expiresAt: z
        .string()
        .datetime()
        .optional()
        .describe(
          'Optional ISO timestamp after which the trigger auto-disables. Set one for time-boxed follow-ups.',
        ),
      dedupeKey: z
        .string()
        .max(200)
        .optional()
        .describe(
          'Optional idempotency key: creating again with the same key returns the existing trigger instead of a duplicate. Use for automation follow-ups (convention: "incident:<id>").',
        ),
      monitoringIdentity: monitoringIdentitySchema
        .optional()
        .describe(
          'Required for every provider Watch, including providers without a dedicated Nuphos skill. Supply a stable normalized provider key plus the exact connected account/integration and monitored resource IDs; the backend scopes and hashes them into a retry-safe dedupe key.',
        ),
      minIntervalSeconds: z
        .number()
        .int()
        .min(0)
        .max(86400)
        .optional()
        .describe(
          'Webhook triggers only — flood guard: minimum seconds between runs; deliveries inside the window are acknowledged but not executed. Defaults to a server-side cooldown (60s) when unset; set higher when the user wants "at most every N minutes", 0 only if they explicitly want every delivery to run.',
        ),
      incidentMode: z
        .boolean()
        .optional()
        .describe(
          'Set true only for a monitoring webhook whose action posts to Slack. Keeps one open incident root, routes material updates into its thread, suppresses repeats, and closes it once on recovery.',
        ),
      slackDestination: slackDestinationSchema
        .optional()
        .describe(
          'Required with incidentMode=true: the exact Slack DM or stable channel ID the user approved. The server rejects every other slack_post destination.',
        ),
    }),
    execute: async (input) =>
      run(async () => {
        if (origin === 'trigger') {
          return {
            ok: false as const,
            error:
              'trigger_create is disabled in sessions that were themselves fired by a trigger (self-replication guard). Ask the user to request this in a normal conversation.',
          }
        }
        if (input.monitoringIdentity && input.dedupeKey) {
          return {
            ok: false as const,
            error: 'Use monitoringIdentity for a provider Watch; do not also set dedupeKey.',
          }
        }
        if (input.monitoringIdentity && input.triggerType !== 'webhook') {
          return {
            ok: false as const,
            error: 'monitoringIdentity is only valid for webhook Watches.',
          }
        }
        const created = await createTrigger(
          {
            name: input.name,
            triggerType: input.triggerType,
            ...(input.cronExpression ? { cronExpression: input.cronExpression } : {}),
            messageTemplate: input.messageTemplate,
            ...(input.expiresAt ? { expiresAt: new Date(input.expiresAt) } : {}),
            ...(input.dedupeKey ? { dedupeKey: input.dedupeKey } : {}),
            ...(input.monitoringIdentity ? { monitoringIdentity: input.monitoringIdentity } : {}),
            ...(input.minIntervalSeconds !== undefined
              ? { minIntervalSeconds: input.minIntervalSeconds }
              : {}),
            ...(input.incidentMode !== undefined ? { incidentMode: input.incidentMode } : {}),
            ...(input.slackDestination ? { slackDestination: input.slackDestination } : {}),
          },
          {
            ...scope,
            source: 'agent',
            sourceContext: { sessionId },
          },
        )

        return {
          ok: true as const,
          trigger: created,
          ...(created.triggerType === 'cron' && created.cronExpression
            ? { nextRuns: nextCronRuns(created.cronExpression), timeZone: CRON_TIME_ZONE }
            : {}),
          ...(created.triggerType === 'webhook'
            ? {
                webhookUrl: webhookUrlFor(created.id),
                secretHeader: 'X-Webhook-Secret',
                providerWiring: pendingWebhookProviderWiring(),
              }
            : {}),
        }
      }),
  })

  const trigger_list = tool({
    description:
      "List the user's agent triggers (cron + webhook) with schedule, template, enabled state, and last run time. Webhook secrets are never included.",
    inputSchema: z.object({ label }),
    execute: async () =>
      run(async () => ({ ok: true as const, triggers: await listTriggers(scope) })),
  })

  const trigger_update = tool({
    description:
      'Update an existing trigger: rename, enable/disable, change the cron schedule, or rewrite the message template. Applies immediately. ' +
      'When the user directly asks to change a specific trigger (e.g. "change my PR digest to 10am", "just modify the existing one"), their message IS the confirmation — do it right away, do not ask again. ' +
      'The ONE case to pause on: if the user asked you to set up NEW recurring work and you notice an existing trigger that already covers it, do not silently repurpose it — tell them it exists and ask whether to modify that one or add a separate new one. (Near-duplicate detection on brand-new trigger creation is handled by trigger_create; this pause applies specifically when you were about to reuse/repurpose an existing trigger via trigger_update.)',
    inputSchema: z.object({
      label,
      triggerId: z.string().min(1),
      name: z.string().min(1).max(100).optional(),
      messageTemplate: z.string().min(1).optional(),
      enabled: z.boolean().optional(),
      cronExpression: z
        .string()
        .optional()
        .describe('New 5-field cron expression (cron triggers only, UTC).'),
      minIntervalSeconds: z
        .number()
        .int()
        .min(0)
        .max(86400)
        .optional()
        .describe(
          'Webhook triggers only — flood guard: minimum seconds between runs (deliveries inside the window are acknowledged but not executed). 0 disables the guard.',
        ),
      incidentMode: z
        .boolean()
        .optional()
        .describe('Enable/disable stateful Slack incident delivery for a monitoring webhook.'),
      slackDestination: slackDestinationSchema
        .nullable()
        .optional()
        .describe('Replace the approved Slack destination, or null when disabling incident mode.'),
    }),
    execute: async (input) =>
      run(async () => {
        const updated = await updateTrigger(input.triggerId, scope, {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.messageTemplate !== undefined
            ? { messageTemplate: input.messageTemplate }
            : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          ...(input.cronExpression !== undefined ? { cronExpression: input.cronExpression } : {}),
          ...(input.minIntervalSeconds !== undefined
            ? { minIntervalSeconds: input.minIntervalSeconds }
            : {}),
          ...(input.incidentMode !== undefined ? { incidentMode: input.incidentMode } : {}),
          ...(input.slackDestination !== undefined
            ? { slackDestination: input.slackDestination }
            : {}),
        })

        return {
          ok: true as const,
          trigger: updated,
          ...(updated.triggerType === 'cron' && updated.enabled && updated.cronExpression
            ? { nextRuns: nextCronRuns(updated.cronExpression), timeZone: CRON_TIME_ZONE }
            : {}),
        }
      }),
  })

  const trigger_delete = tool({
    description:
      'Permanently delete a trigger (and unregister its schedule). Always confirm with the user first — prefer trigger_update {enabled:false} when they might want it back.',
    inputSchema: z.object({ label, triggerId: z.string().min(1) }),
    execute: async (input) =>
      run(async () => {
        const result = await deleteTrigger(input.triggerId, scope)

        return {
          ok: true as const,
          status: result.deleted ? ('deleted' as const) : ('removing' as const),
        }
      }),
  })

  const trigger_test_fire = tool({
    description:
      'Fire a trigger once, now, for verification. Fire-and-forget: success means the run was kicked off in a background agent session, not that it finished. Optional payload substitutes the webhook body for {{payload.*}} templates.',
    inputSchema: z.object({
      label,
      triggerId: z.string().min(1),
      payload: z.record(z.string(), z.unknown()).optional(),
    }),
    execute: async (input) =>
      run(async () => {
        const { name } = await testFireTrigger(input.triggerId, scope, input.payload)

        return { ok: true as const, fired: name }
      }),
  })

  return {
    ...createTriggerGroupTools({ userId, teamId, origin, scope }),
    trigger_create,
    trigger_list,
    trigger_update,
    trigger_delete,
    trigger_test_fire,
  }
}
