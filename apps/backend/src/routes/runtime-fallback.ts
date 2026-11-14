import { Hono } from 'hono'
import { z } from 'zod'

import { requireDeviceAccess } from '@/lib/agent/devices/box-access'
import { parseLocalRuntimeId } from '@/lib/agent/devices/local-runtime/address'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { teamRuntimeFallbacks } from '@/models'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { Context } from 'hono'

/**
 * Each runtime's fallback: the agent its conversations move to when it is out
 * of usage or broken. One per runtime, shared by the team.
 */
export const runtimeFallbackRoutes = new Hono<{ Variables: TeamAuthVariables }>()

const putSchema = z.object({ fallbackRuntimeId: z.string().min(1).max(200).nullable() }).strict()

/** Whoever may rename the runtime: a computer's managers, or a team administrator. */
async function requireManage(c: Context<{ Variables: TeamAuthVariables }>, runtimeId: string) {
  const local = parseLocalRuntimeId(runtimeId)

  if (local) await requireDeviceAccess(c.get('userId'), c.get('teamId'), local.deviceId, 'manage')
  else if (c.get('teamRole') !== 'ADMINISTRATOR')
    throw new AppError(403, 'forbidden', 'Requires one of: ADMINISTRATOR')
}

runtimeFallbackRoutes.get('/', async (c) => {
  const docs = await teamRuntimeFallbacks()
    .find({ teamId: parseObjectId(c.get('teamId'), 'teamId') })
    .toArray()

  return c.json({
    fallbacks: Object.fromEntries(docs.map((doc) => [doc.runtimeId, doc.fallbackRuntimeId])),
  })
})

runtimeFallbackRoutes.put('/:runtimeId', zv('json', putSchema), async (c) => {
  const runtimeId = c.req.param('runtimeId')
  const { fallbackRuntimeId } = c.req.valid('json')
  const scope = { teamId: parseObjectId(c.get('teamId'), 'teamId'), runtimeId }

  if (fallbackRuntimeId === runtimeId)
    throw new AppError(400, 'invalid_request', 'An agent cannot be its own fallback.')
  await requireManage(c, runtimeId)
  if (fallbackRuntimeId)
    await teamRuntimeFallbacks().updateOne(
      scope,
      { $set: { fallbackRuntimeId, updatedAt: new Date(), updatedBy: c.get('userId') } },
      { upsert: true },
    )
  else await teamRuntimeFallbacks().deleteOne(scope)

  return c.json({ runtimeId, fallbackRuntimeId })
})
