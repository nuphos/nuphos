import { expect, test } from 'bun:test'

import { useRuntimeCatalog } from '@/lib/test/doubles/runtime-catalog'

import type { TeamAuthVariables } from '@/middleware/auth'

// Run with: cd apps/backend && bun test src/routes/teams/agent-runtimes-shared-status.test.ts

const asked: unknown[][] = []

useRuntimeCatalog({
  requireRuntimeInstance: async (...args) => {
    asked.push(args)
    throw new Error('stop here')
  },
})

test('a teammate’s computer reports its status to whoever may use it, checked as the viewer', async () => {
  const { Hono } = await import('hono')
  const { registerAgentRuntimeRoutes } = await import('./agent-runtimes')
  const app = new Hono<{ Variables: TeamAuthVariables }>()

  app.use('*', async (c, next) => {
    c.set('teamRole', 'EDITOR')
    c.set('teamId', 'team-1')
    c.set('userId', 'mate')
    await next()
  })
  app.onError((error, c) => c.json({ error: error.message }, 500))
  registerAgentRuntimeRoutes(app)
  await app.request('/agent-runtimes/local_owner_mac/status')

  expect(asked).toEqual([['team-1', 'local_owner_mac', 'mate']])
})
