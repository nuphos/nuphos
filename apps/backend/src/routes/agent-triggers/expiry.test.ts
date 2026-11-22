import { beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { AppError } from '@/lib/errors'
import { useDb } from '@/lib/test/doubles/db'

import type { AuthVariables } from '@/middleware/auth'

const OWNER = new ObjectId().toHexString()
const triggerId = new ObjectId()
const OLD_EXPIRY = new Date(Date.now() + 60 * 60 * 1000)
const NEW_EXPIRY = new Date(Date.now() + 3 * 60 * 60 * 1000)

let row: Record<string, unknown>

// One in-memory Trigger, so a PATCH and the GET after it see the same row.
function collection(name: string) {
  return {
    findOne: () => Promise.resolve(name === 'agent_triggers' ? { ...row } : null),
    countDocuments: () => Promise.resolve(0),
    updateOne: (_filter: unknown, update: Record<string, Record<string, unknown>>) => {
      if (name === 'agent_triggers') {
        if (update.$unset?.expiresAt) delete row.expiresAt
        Object.assign(row, update.$set)
      }

      return Promise.resolve({ matchedCount: 1, modifiedCount: 1 })
    },
    insertOne: () => Promise.resolve({ insertedId: null }),
    updateMany: () => Promise.resolve({ matchedCount: 0, modifiedCount: 0 }),
    deleteMany: () => Promise.resolve({ deletedCount: 0 }),
    find: () => ({ toArray: () => Promise.resolve([]) }),
  }
}

useDb({
  db: () => ({ collection }) as never,
  withTransaction: (body: (session: never) => Promise<void>) => body({} as never),
})

const { registerTriggerItemRoutes } = await import('./items')

const app = new Hono<{ Variables: AuthVariables }>()

app.use(async (c, next) => {
  c.set('userId', OWNER)
  await next()
})
app.onError((err, c) => c.json({ error: err.message }, err instanceof AppError ? 400 : 500))
registerTriggerItemRoutes(app)

const patch = (body: Record<string, unknown>) =>
  app.request(`/${triggerId.toHexString()}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
const readBack = async () =>
  (await (await app.request(`/${triggerId.toHexString()}`)).json()) as Record<string, unknown>

beforeEach(() => {
  row = {
    _id: triggerId,
    userId: OWNER,
    name: 'Release check',
    messageTemplate: 'Check the release',
    triggerType: 'cron',
    cronExpression: '0 9 * * *',
    timeZone: 'UTC',
    targetSessionId: 'bound-session',
    enabled: false,
    configRevision: 1,
    expiresAt: OLD_EXPIRY,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
})

describe('PATCH persists expiresAt', () => {
  test('a new expiry and cron in one request are both read back', async () => {
    const res = await patch({ expiresAt: NEW_EXPIRY.toISOString(), cronExpression: '0 10 * * *' })

    expect(res.status).toBe(200)
    expect(await readBack()).toMatchObject({
      cronExpression: '0 10 * * *',
      expiresAt: NEW_EXPIRY.toISOString(),
    })
  })

  test('null removes the expiry', async () => {
    expect((await patch({ expiresAt: null })).status).toBe(200)
    expect(await readBack()).not.toHaveProperty('expiresAt')
  })

  test('an invalid or past expiry is rejected and leaves the stored one', async () => {
    for (const expiresAt of ['not a date', 1_900_000_000_000, '2020-01-01T00:00:00.000Z']) {
      expect([expiresAt, (await patch({ expiresAt })).status]).toEqual([expiresAt, 400])
    }
    expect(await readBack()).toMatchObject({ expiresAt: OLD_EXPIRY.toISOString() })
  })
})
