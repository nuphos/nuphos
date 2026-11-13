import { expect, test } from 'bun:test'
import { Hono } from 'hono'

import { errorHandler } from '@/lib/errors'

import { registerTeamMigrationRoutes } from './migration'

import type { TeamAuthVariables } from '@/middleware/auth'

function app(
  role: TeamAuthVariables['teamRole'],
  sessionId?: string,
  cliToken?: TeamAuthVariables['cliToken'],
) {
  const routes = new Hono<{ Variables: TeamAuthVariables }>()

  routes.onError(errorHandler)
  routes.use('*', async (c, next) => {
    c.set('teamId', '000000000000000000000001')
    c.set('teamRole', role)
    if (sessionId) c.set('sessionId', sessionId)
    if (cliToken) c.set('cliToken', cliToken)
    await next()
  })
  registerTeamMigrationRoutes(routes)

  return routes
}

test('editors and viewers cannot export private team conversations', async () => {
  for (const role of ['EDITOR', 'VIEWER'] as const) {
    const response = await app(role, 'signed-in').request('/migration/export', { method: 'POST' })

    expect(response.status).toBe(403)
  }
})

test('administrator role on agent or CLI auth cannot export', async () => {
  const response = await app('ADMINISTRATOR').request('/migration/export', { method: 'POST' })

  expect(response.status).toBe(403)
  expect(await response.json()).toMatchObject({ error: { code: 'user_session_required' } })
})
