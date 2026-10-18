import { expect, test } from 'bun:test'

import { useBoxUpdate } from '@/lib/test/doubles/box-update'
import { useRuntimeCatalog } from '@/lib/test/doubles/runtime-catalog'

import type { TeamAuthVariables } from '@/middleware/auth'

// Run with: cd apps/backend && bun test src/routes/teams/agent-runtimes-box-update.test.ts

const asked: (string | undefined)[] = []

useRuntimeCatalog({
  // A Box's agents are listed only for a user, so the route must pass the actor.
  requireRuntimeInstance: async (_teamId, runtimeId, userId) => {
    asked.push(userId)
    if (!userId) throw new Error('not found')

    return {
      id: runtimeId,
      provider: 'claude-code',
      label: 'Box 1',
      status: 'active',
      kind: 'local',
      createdAt: '',
    }
  },
})
useBoxUpdate({
  requestBoxUpdate: async (_teamId, _runtimeId, actorId) => {
    asked.push(`update:${actorId}`)

    return { version: '0.5.0' }
  },
})

async function post(role: string) {
  const { Hono } = await import('hono')
  const { registerAgentRuntimeRoutes } = await import('./agent-runtimes')
  const { AppError } = await import('@/lib/errors')
  const app = new Hono<{ Variables: TeamAuthVariables }>()

  app.use('*', async (c, next) => {
    c.set('teamRole', role as TeamAuthVariables['teamRole'])
    c.set('teamId', 'team-1')
    c.set('userId', 'admin-1')
    await next()
  })
  app.onError((error, c) =>
    c.json({ error: error.message }, error instanceof AppError ? error.status : 500),
  )
  registerAgentRuntimeRoutes(app)

  return app.request('/agent-runtimes/local_u1_box-1/update', { method: 'POST' })
}

test('an administrator updates a Box agent as themselves', async () => {
  asked.length = 0
  const response = await post('ADMINISTRATOR')

  expect(response.status).toBe(202)
  expect(await response.json()).toEqual({ version: '0.5.0' })
  expect(asked).toEqual(['admin-1', 'update:admin-1'])
})

test('a member who is not an administrator cannot update a Box agent', async () => {
  asked.length = 0
  const response = await post('EDITOR')

  expect(response.status).toBe(403)
  expect(asked).toEqual([])
})
