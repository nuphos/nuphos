import { Hono } from 'hono'
import { z } from 'zod'

import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { userTeamRuntimeFallbacks } from '@/models'

import type { TeamAuthVariables } from '@/middleware/auth'

/**
 * The caller's own fallback list: the agents their conversations move to, in
 * order, when the one they run on is out of usage or broken. An empty list
 * turns fallback off.
 */
export const runtimeFallbackRoutes = new Hono<{ Variables: TeamAuthVariables }>()

const putSchema = z.object({ runtimeIds: z.array(z.string().min(1).max(200)).max(20) }).strict()

runtimeFallbackRoutes.get('/', async (c) => {
  const doc = await userTeamRuntimeFallbacks().findOne({
    teamId: parseObjectId(c.get('teamId'), 'teamId'),
    userId: c.get('userId'),
  })

  return c.json({ runtimeIds: doc?.runtimeIds ?? [] })
})

runtimeFallbackRoutes.put('/', zv('json', putSchema), async (c) => {
  const scope = { teamId: parseObjectId(c.get('teamId'), 'teamId'), userId: c.get('userId') }
  const runtimeIds = [...new Set(c.req.valid('json').runtimeIds)]

  if (runtimeIds.length)
    await userTeamRuntimeFallbacks().updateOne(
      scope,
      { $set: { runtimeIds, updatedAt: new Date() } },
      { upsert: true },
    )
  else await userTeamRuntimeFallbacks().deleteOne(scope)

  return c.json({ runtimeIds })
})
