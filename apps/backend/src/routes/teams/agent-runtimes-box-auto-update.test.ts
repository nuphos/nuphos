import { expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useDb } from '@/lib/test/doubles/db'

import type { NuphosTeamDoc } from '@/lib/identity/shared'
import type { TeamAuthVariables } from '@/middleware/auth'

// Run with: cd apps/backend && bun test src/routes/teams/agent-runtimes-box-auto-update.test.ts

const teamId = new ObjectId()
const team: NuphosTeamDoc = {
  _id: teamId,
  name: 'Box team',
  avatarUrl: '',
  ownerID: new ObjectId(),
  contactEmails: [],
  members: [],
  createdAt: new Date(),
  updatedAt: new Date(),
}
const updates: unknown[] = []

useDb({
  db: () => ({
    collection: () => ({
      findOneAndUpdate: (_filter: unknown, update: { $set?: object; $unset?: object }) => {
        updates.push(update)
        if (update.$unset) delete team.boxAutoUpdate
        else team.boxAutoUpdate = false

        return Promise.resolve(team)
      },
      // The team directory's cache of the team.
      updateOne: () => Promise.resolve({}),
    }),
  }),
})

async function put(role: string, enabled: boolean) {
  const { Hono } = await import('hono')
  const { registerAgentRuntimeRoutes } = await import('./agent-runtimes')
  const { AppError } = await import('@/lib/errors')
  const app = new Hono<{ Variables: TeamAuthVariables }>()

  app.use('*', async (c, next) => {
    c.set('teamRole', role as TeamAuthVariables['teamRole'])
    c.set('teamId', teamId.toHexString())
    c.set('userId', 'admin-1')
    await next()
  })
  app.onError((error, c) =>
    c.json({ error: error.message }, error instanceof AppError ? error.status : 500),
  )
  registerAgentRuntimeRoutes(app)

  return app.request('/box-auto-update', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled }),
  })
}

test('an administrator turns the Boxes’ automatic updates off and on again', async () => {
  const off = await put('ADMINISTRATOR', false)

  expect(off.status).toBe(200)
  expect(((await off.json()) as { boxAutoUpdate: boolean }).boxAutoUpdate).toBe(false)
  const on = await put('ADMINISTRATOR', true)

  expect(((await on.json()) as { boxAutoUpdate: boolean }).boxAutoUpdate).toBe(true)
  // Turned on is stored as no setting at all, the same as a team that never chose.
  expect(updates.at(-1)).toMatchObject({ $unset: { boxAutoUpdate: '' } })
})

test('a member who is not an administrator cannot change it', async () => {
  updates.length = 0
  expect((await put('EDITOR', false)).status).toBe(403)
  expect(updates).toEqual([])
})
