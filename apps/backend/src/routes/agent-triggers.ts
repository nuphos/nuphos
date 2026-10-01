import { Hono } from 'hono'

import { assertTeamTriggerRole } from '@/lib/agent/trigger-access'
import { listTriggers } from '@/lib/agent/trigger-service'
import { redisEnabled } from '@/lib/redis'
import { requireAuth } from '@/middleware/auth'
import { registerTriggerGroupRoutes } from '@/routes/agent-triggers/groups'
import { registerTriggerItemRoutes } from '@/routes/agent-triggers/items'
import { triggerActor } from '@/routes/agent-triggers/shared'

import type { AuthVariables } from '@/middleware/auth'

export { jsonObjectBody } from '@/routes/agent-triggers/shared'

// Thin HTTP shells over lib/agent/trigger-service.ts — the service owns
// validation, secrets, scheduling, rollback, and quota so the agent tools and
// automation callers behave identically to this UI-facing surface.
export const agentTriggersRoutes = new Hono<{ Variables: AuthVariables }>()

agentTriggersRoutes.use('*', async (c, next) => {
  // The canonical router is mounted both at /agent/triggers (ordinary user
  // sessions) and /teams/:teamId/agent-triggers (already authenticated by the
  // team router, including conversation principals).
  if (c.get('userId')) return next()

  return requireAuth(c, next)
})

// Scheduler status — UI uses this to warn users that creating a cron trigger
// won't auto-fire when Redis isn't configured (no BullMQ backing store).
// Webhook triggers are unaffected.
agentTriggersRoutes.get('/scheduler-status', async (c) => {
  return c.json({ cronEnabled: redisEnabled() })
})

// List triggers
agentTriggersRoutes.get('/', async (c) => {
  const actor = await triggerActor(c, c.req.query('teamId'))

  await assertTeamTriggerRole(actor, 'read')

  return c.json(await listTriggers(actor))
})

registerTriggerGroupRoutes(agentTriggersRoutes)
registerTriggerItemRoutes(agentTriggersRoutes)
