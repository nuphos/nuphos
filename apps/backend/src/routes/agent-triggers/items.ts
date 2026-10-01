import { finalizeTriggerGroupIngress } from '@/lib/agent/trigger-group-service'
import { monitoringProviderWiringSchema } from '@/lib/agent/trigger-provider-wiring'
import {
  createTrigger,
  deleteTrigger,
  finalizeTriggerProviderWiring,
  getTrigger,
  testFireTrigger,
  testTriggerDestination,
  transferTriggerExecutionPrincipal,
  updateTrigger,
} from '@/lib/agent/trigger-service'
import { monitoringIdentitySchema, webhookUrlFor } from '@/lib/agent/tools-triggers-shared'
import { CRON_TIME_ZONE, nextCronRuns } from '@/lib/cron'
import { AppError } from '@/lib/errors'
import { jsonObjectBody, parseSlackDestination, triggerActor } from '@/routes/agent-triggers/shared'

import type { TriggerType } from '@/lib/agent/trigger-db'
import type { AuthVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

export function registerTriggerItemRoutes(agentTriggersRoutes: Hono<{ Variables: AuthVariables }>) {
  // Get trigger. Team membership controls visibility; the desktop additionally
  // keeps secret reveal/copy controls restricted to trigger managers.
  agentTriggersRoutes.get('/:triggerId', async (c) => {
    const { triggerId } = c.req.param()

    return c.json(await getTrigger(triggerId, await triggerActor(c, c.req.query('teamId'))))
  })

  // Create trigger
  agentTriggersRoutes.post('/', async (c) => {
    const body = await jsonObjectBody(c)

    if (typeof body.name !== 'string')
      throw new AppError(400, 'invalid_request', 'name is required')
    if (typeof body.messageTemplate !== 'string') {
      throw new AppError(400, 'invalid_request', 'messageTemplate is required')
    }

    const actor = await triggerActor(c, body.teamId)
    const slackDestination = parseSlackDestination(body.slackDestination)
    const monitoringIdentity = monitoringIdentitySchema.safeParse(body.monitoringIdentity)

    if (body.monitoringIdentity !== undefined && !monitoringIdentity.success) {
      throw new AppError(400, 'invalid_request', 'monitoringIdentity is invalid')
    }
    const created = await createTrigger(
      {
        name: body.name,
        triggerType: body.triggerType as TriggerType,
        ...(typeof body.cronExpression === 'string' ? { cronExpression: body.cronExpression } : {}),
        messageTemplate: body.messageTemplate,
        ...(typeof body.expiresAt === 'string' ? { expiresAt: new Date(body.expiresAt) } : {}),
        ...(typeof body.dedupeKey === 'string' ? { dedupeKey: body.dedupeKey } : {}),
        ...(monitoringIdentity.success ? { monitoringIdentity: monitoringIdentity.data } : {}),
        ...(typeof body.minIntervalSeconds === 'number'
          ? { minIntervalSeconds: body.minIntervalSeconds }
          : {}),
        ...(typeof body.incidentMode === 'boolean' ? { incidentMode: body.incidentMode } : {}),
        ...(slackDestination ? { slackDestination } : {}),
      },
      {
        ...actor,
        source: 'user',
        ...(actor.sessionId ? { sourceContext: { sessionId: actor.sessionId } } : {}),
      },
    )

    return c.json(
      {
        ...created,
        ...(created.triggerType === 'webhook'
          ? { webhookUrl: webhookUrlFor(created.id), secretHeader: 'X-Webhook-Secret' }
          : {}),
        ...(created.triggerType === 'cron' && created.cronExpression
          ? { nextRuns: nextCronRuns(created.cronExpression), timeZone: CRON_TIME_ZONE }
          : {}),
      },
      201,
    )
  })

  // Update trigger (name, enabled, messageTemplate, cronExpression)
  agentTriggersRoutes.patch('/:triggerId', async (c) => {
    const { triggerId } = c.req.param()
    const body = await jsonObjectBody(c)
    const actor = await triggerActor(c, body.teamId ?? c.req.query('teamId'))
    const slackDestination =
      body.slackDestination === null ? null : parseSlackDestination(body.slackDestination)
    const updated = await updateTrigger(triggerId, actor, {
      ...(typeof body.name === 'string' ? { name: body.name } : {}),
      ...(typeof body.messageTemplate === 'string'
        ? { messageTemplate: body.messageTemplate }
        : {}),
      ...(typeof body.enabled === 'boolean' ? { enabled: body.enabled } : {}),
      ...(typeof body.cronExpression === 'string' ? { cronExpression: body.cronExpression } : {}),
      ...(typeof body.minIntervalSeconds === 'number'
        ? { minIntervalSeconds: body.minIntervalSeconds }
        : {}),
      ...(typeof body.incidentMode === 'boolean' ? { incidentMode: body.incidentMode } : {}),
      ...(body.slackDestination === null || slackDestination ? { slackDestination } : {}),
    })

    return c.json(updated)
  })

  // Administrator-only: move who a Trigger runs as. The main use is recovering a
  // Watch whose creator left the team, which pauses it.
  agentTriggersRoutes.post('/:triggerId/execution-principal', async (c) => {
    const { triggerId } = c.req.param()
    const body = await jsonObjectBody(c)

    if (typeof body.userId !== 'string') {
      throw new AppError(400, 'invalid_request', 'userId is required')
    }

    return c.json(
      await transferTriggerExecutionPrincipal(
        triggerId,
        await triggerActor(c, body.teamId ?? c.req.query('teamId')),
        body.userId,
      ),
    )
  })

  // Delete trigger
  agentTriggersRoutes.delete('/:triggerId', async (c) => {
    const { triggerId } = c.req.param()
    const result = await deleteTrigger(triggerId, await triggerActor(c, c.req.query('teamId')))

    return c.json({ ok: true, ...result }, result.deleted ? 200 : 202)
  })

  // Verify the destination configured by the desktop UI. Slack-backed Watches
  // receive one clearly marked direct test, bypassing incident investigation and
  // dedupe. Nuphos-only triggers retain the background agent verification.
  // Real provider webhooks and the agent-facing trigger_test_fire tool still use
  // testFireTrigger, so this UI-only behavior cannot alter real alert handling.
  agentTriggersRoutes.post('/:triggerId/test-fire', async (c) => {
    const { triggerId } = c.req.param()
    const actor = await triggerActor(c, c.req.query('teamId'))

    // Accept an empty body (no payload override), but reject a non-empty
    // body that isn't valid JSON so client bugs surface instead of silently
    // falling through to the default test_fire payload.
    const rawBody = await c.req.text()
    let body: Record<string, unknown> = {}

    if (rawBody.trim()) {
      let parsed: unknown

      try {
        parsed = JSON.parse(rawBody)
      } catch {
        throw new AppError(400, 'invalid_request', 'Body must be valid JSON')
      }
      // JSON.parse('null') / '"x"' / '[]' all return non-object values; reading
      // .payload on them would either be undefined or throw, so reject upfront.
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new AppError(400, 'invalid_request', 'Body must be a JSON object')
      }
      body = parsed as Record<string, unknown>
    }

    const conversationAgent = (
      c as unknown as { get(key: 'conversationAgent'): { sessionId: string } | undefined }
    ).get('conversationAgent')

    if (conversationAgent) {
      const result = await testFireTrigger(
        triggerId,
        actor,
        body.payload && typeof body.payload === 'object' ? body.payload : undefined,
      )

      return c.json({ ok: true, fired: result.name })
    }

    return c.json(await testTriggerDestination(triggerId, actor, body.payload))
  })

  agentTriggersRoutes.post('/:triggerId/finalize-wiring', async (c) => {
    const { triggerId } = c.req.param()
    const body = await jsonObjectBody(c)
    const wiring = monitoringProviderWiringSchema.safeParse(body.wiring)

    if (!wiring.success) {
      throw new AppError(400, 'invalid_request', 'wiring is invalid')
    }

    const actor = await triggerActor(c, body.teamId)

    if (wiring.data.provider === 'watch_group') {
      if (!actor.teamId) {
        throw new AppError(400, 'trigger_group_team_required', 'A team is required')
      }

      return c.json(
        await finalizeTriggerGroupIngress({
          triggerId,
          userId: actor.userId,
          teamId: actor.teamId,
          receipt: wiring.data,
        }),
      )
    }

    return c.json(await finalizeTriggerProviderWiring(triggerId, actor, wiring.data))
  })
}
