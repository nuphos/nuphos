import { Hono } from 'hono'

import { listClustersForTeam } from '@/lib/byos'
import { parseObjectId } from '@/lib/objectid'
import { teamByosBindings } from '@/models'

import type { TeamAuthVariables } from '@/middleware/auth'

export const teamClusters = new Hono<{ Variables: TeamAuthVariables }>()

teamClusters.get('/', async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const doc = await teamByosBindings().findOne({ _id: teamId })

  return c.json(await listClustersForTeam(doc))
})
