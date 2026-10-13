import { z } from 'zod'

import { listRuntimeInstances, listRuntimeQuotas } from '@/lib/claude-code-preview/runtime-catalog'
import {
  listRuntimeQuotaHistory,
  QUOTA_HISTORY_RANGES,
} from '@/lib/claude-code-preview/runtime-quota-history'
import { zv } from '@/lib/validate'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

/** Provider usage for every agent in the team, each read by the agent that
 *  holds its own credential. */
export function registerRuntimeQuotaRoutes(teamScoped: Hono<{ Variables: TeamAuthVariables }>) {
  teamScoped.get('/agent-runtimes/quota', async (c) => {
    const teamId = c.get('teamId')
    // With the user, so their own computers' agents are in the list at all.
    const instances = await listRuntimeInstances(teamId, c.get('userId'))

    return c.json({ quotas: await listRuntimeQuotas(teamId, instances) })
  })
  // Only the agents this caller can list, so the history shows nothing the
  // live readings above would not.
  teamScoped.get(
    '/agent-runtimes/quota/history',
    zv(
      'query',
      z.object({
        range: z
          .enum(Object.keys(QUOTA_HISTORY_RANGES) as [keyof typeof QUOTA_HISTORY_RANGES])
          .default('1d'),
      }),
    ),
    async (c) => {
      const instances = await listRuntimeInstances(c.get('teamId'), c.get('userId'))

      return c.json({
        series: await listRuntimeQuotaHistory(
          instances.map((instance) => instance.id),
          c.req.valid('query').range,
        ),
      })
    },
  )
}
