import { afterEach, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useDb } from '@/lib/test/doubles/db'

const OWNER = new ObjectId().toHexString()
const TEAM = new ObjectId().toHexString()
const triggerId = new ObjectId()
const writes: Record<string, Record<string, unknown>>[] = []

const cronTrigger = {
  _id: triggerId,
  userId: OWNER,
  teamId: TEAM,
  name: 'Morning digest',
  messageTemplate: 'Summarize',
  triggerType: 'cron',
  cronExpression: '0 9 * * *',
  timeZone: 'UTC',
  targetSessionId: 'bound-session',
  enabled: true,
  configRevision: 1,
  missedRunAt: new Date('2026-11-13T09:00:00.000Z'),
  createdAt: new Date(),
  updatedAt: new Date(),
}

const rows: Record<string, unknown> = {
  teams: {
    _id: new ObjectId(TEAM),
    name: 'Team',
    ownerID: new ObjectId(OWNER),
    contactEmails: [],
    createdAt: new Date(),
    members: [{ userId: new ObjectId(OWNER), role: 'ADMINISTRATOR', joinedAt: new Date() }],
  },
}

function collection(name: string) {
  return {
    findOne: () => Promise.resolve(name === 'agent_triggers' ? cronTrigger : (rows[name] ?? null)),
    countDocuments: () => Promise.resolve(0),
    findOneAndUpdate: () => Promise.resolve(null),
    updateOne: (_filter: unknown, update: Record<string, Record<string, unknown>>) => {
      if (name === 'agent_triggers') writes.push(update)

      return Promise.resolve({ matchedCount: 1, modifiedCount: 1 })
    },
    updateMany: () => Promise.resolve({ matchedCount: 0, modifiedCount: 0 }),
    deleteMany: () => Promise.resolve({ deletedCount: 0 }),
    find: () => ({ toArray: () => Promise.resolve([]) }),
  }
}

useDb({ db: () => ({ collection }) as never })

const { updateTrigger } = await import('./update')

afterEach(() => {
  writes.length = 0
})

describe('the missed-run marker belongs to the schedule it was raised for', () => {
  const edit = async (patch: Parameters<typeof updateTrigger>[2]) => {
    await updateTrigger(triggerId.toHexString(), OWNER, patch)

    return writes[0]?.$unset
  }

  test('a new cron expression clears it', async () => {
    expect(await edit({ cronExpression: '0 10 * * *' })).toMatchObject({ missedRunAt: true })
  })

  test('a new time zone clears it', async () => {
    expect(await edit({ timeZone: 'Europe/Stockholm' })).toMatchObject({ missedRunAt: true })
  })

  test('disabling clears it, so re-enabling starts clean', async () => {
    expect(await edit({ enabled: false })).toMatchObject({ missedRunAt: true })
  })

  test('a rename leaves it alone', async () => {
    expect(await edit({ name: 'Renamed' })).toBeUndefined()
  })
})
