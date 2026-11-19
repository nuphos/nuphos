import {
  createTrigger,
  deleteTrigger,
  getTrigger,
  testFireTrigger,
  updateTrigger,
} from '@/lib/agent/trigger-service'
import { getTriggerUsage } from '@/lib/agent/trigger-usage'
import { CRON_TIME_ZONE, nextCronRuns } from '@/lib/cron'
import { AppError } from '@/lib/errors'
import { jsonObjectBody, triggerActor, webhookUrlFor } from '@/routes/agent-triggers/shared'

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

  // What this trigger's fires spent over the last seven days. Reading it needs
  // no more than reading the trigger itself; a runtime that reported nothing
  // leaves the totals at zero rather than an estimate.
  agentTriggersRoutes.get('/:triggerId/usage', async (c) => {
    const { triggerId } = c.req.param()
    const actor = await triggerActor(c, c.req.query('teamId'))

    await getTrigger(triggerId, actor)

    return c.json(await getTriggerUsage(triggerId, actor.teamId))
  })

  // Create trigger
  agentTriggersRoutes.post('/', async (c) => {
    const body = await jsonObjectBody(c)

    if (typeof body.name !== 'string')
      throw new AppError(400, 'invalid_request', 'name is required')
    if (typeof body.messageTemplate !== 'string') {
      throw new AppError(400, 'invalid_request', 'messageTemplate is required')
    }

    if (typeof body.targetSessionId !== 'string') {
      throw new AppError(400, 'invalid_request', 'targetSessionId is required')
    }

    const actor = await triggerActor(c, body.teamId)
    const created = await createTrigger(
      {
        targetSessionId: body.targetSessionId,
        name: body.name,
        triggerType: body.triggerType as TriggerType,
        ...(typeof body.cronExpression === 'string' ? { cronExpression: body.cronExpression } : {}),
        ...(typeof body.timeZone === 'string' ? { timeZone: body.timeZone } : {}),
        ...(typeof body.enabled === 'boolean' ? { enabled: body.enabled } : {}),
        messageTemplate: body.messageTemplate,
        ...(typeof body.expiresAt === 'string' ? { expiresAt: new Date(body.expiresAt) } : {}),
        ...(typeof body.dedupeKey === 'string' ? { dedupeKey: body.dedupeKey } : {}),
        ...(typeof body.minIntervalSeconds === 'number'
          ? { minIntervalSeconds: body.minIntervalSeconds }
          : {}),
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
          ? {
              nextRuns: nextCronRuns(created.cronExpression, 3, created.timeZone),
              timeZone: created.timeZone ?? CRON_TIME_ZONE,
            }
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

    // A Trigger belongs to the one Task it was created in.
    if (body.targetSessionId !== undefined) {
      throw new AppError(
        400,
        'invalid_target_session',
        'A Trigger stays in the Task it was created in; create a new one in the other Task',
      )
    }
    const updated = await updateTrigger(triggerId, actor, {
      ...(typeof body.name === 'string' ? { name: body.name } : {}),
      ...(typeof body.messageTemplate === 'string'
        ? { messageTemplate: body.messageTemplate }
        : {}),
      ...(typeof body.enabled === 'boolean' ? { enabled: body.enabled } : {}),
      ...(typeof body.cronExpression === 'string' ? { cronExpression: body.cronExpression } : {}),
      ...(typeof body.timeZone === 'string' ? { timeZone: body.timeZone } : {}),
      ...(typeof body.minIntervalSeconds === 'number'
        ? { minIntervalSeconds: body.minIntervalSeconds }
        : {}),
    })

    return c.json(updated)
  })

  agentTriggersRoutes.delete('/:triggerId', async (c) => {
    const { triggerId } = c.req.param()

    await deleteTrigger(triggerId, await triggerActor(c, c.req.query('teamId')))

    return c.json({ ok: true, deleted: true })
  })

  // Queue one fire into the Trigger's bound Task, with an optional payload
  // override standing in for the webhook body.
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

    const result = await testFireTrigger(
      triggerId,
      actor,
      body.payload && typeof body.payload === 'object' ? body.payload : undefined,
    )

    return c.json({ ok: true, fired: result.name })
  })
}
