import { afterEach, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { config } from '@/config'
import { useDb } from '@/lib/test/doubles/db'

const OWNER = new ObjectId().toHexString()
const TEAM = new ObjectId().toHexString()
const triggerId = new ObjectId()
let enabledCount = 0
let writes = 0

const trigger = {
  _id: triggerId,
  userId: OWNER,
  teamId: TEAM,
  name: 'Nightly',
  messageTemplate: 'Run the nightly check',
  triggerType: 'cron',
  cronExpression: '0 3 * * *',
  enabled: false,
  targetSessionId: 'session-1',
  createdAt: new Date(),
  updatedAt: new Date(),
}

const team = {
  _id: new ObjectId(TEAM),
  name: 'Team',
  ownerID: new ObjectId(OWNER),
  contactEmails: [],
  createdAt: new Date(),
  members: [{ userId: new ObjectId(OWNER), role: 'ADMINISTRATOR', joinedAt: new Date() }],
}

function collection(name: string) {
  const write = () => {
    writes++

    return Promise.resolve({ matchedCount: 1, modifiedCount: 1 })
  }

  return {
    findOne: () => Promise.resolve(name === 'teams' ? team : trigger),
    countDocuments: () => Promise.resolve(enabledCount),
    updateOne: write,
    findOneAndUpdate: write,
  }
}

useDb({ db: () => ({ collection }) as never })

const { updateTrigger } = await import('./update')

afterEach(() => {
  enabledCount = 0
  writes = 0
})

describe('re-enabling a Trigger', () => {
  test('is refused once its team is at the enabled-Trigger limit', async () => {
    enabledCount = config.agent.triggers.maxPerTeam

    await expect(
      updateTrigger(triggerId.toHexString(), OWNER, { enabled: true }),
    ).rejects.toMatchObject({ status: 429, code: 'team_trigger_quota_exceeded' })
    expect(writes).toBe(0)
  })
})
