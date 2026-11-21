// What a member's own Trigger list returns, against a real database (#4167).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { closeDb, connectDb } from '@/lib/db'
import { teams } from '@/lib/identity/shared'

import { agentTriggers } from '../trigger-db'

import { listTriggers } from './read'

const TEAM = new ObjectId()
const MEMBER = new ObjectId()
const teamId = TEAM.toHexString()
const userId = MEMBER.toHexString()
const OLDEST = new ObjectId()

describe.skipIf(!process.env.TEST_MONGODB_URI)('a member’s Trigger list', () => {
  beforeAll(async () => {
    await connectDb()
    const joinedAt = new Date('2026-11-01T00:00:00Z')

    await teams().insertOne({
      _id: TEAM,
      name: 'Trigger list',
      ownerID: MEMBER,
      createdAt: joinedAt,
      members: [{ userId: MEMBER, role: 'EDITOR', joinedAt }],
    } as never)
    // The oldest is enabled, and 100 disabled ones were created after it.
    await agentTriggers().insertMany(
      Array.from({ length: 101 }, (_, index) => ({
        ...(index === 0 ? { _id: OLDEST } : {}),
        teamId,
        userId,
        name: `Trigger ${String(index)}`,
        triggerType: 'webhook',
        enabled: index === 0,
        createdAt: new Date(joinedAt.getTime() + index * 60_000),
      })) as never,
    )
  })

  afterAll(async () => {
    await teams().deleteOne({ _id: TEAM })
    await agentTriggers().deleteMany({ teamId })
    await closeDb()
  })

  test('lists every Trigger the member owns, also past the newest 100', async () => {
    const listed = await listTriggers({ userId, teamId })

    expect(listed).toHaveLength(101)
    expect(listed.some((trigger) => trigger.id === OLDEST.toHexString())).toBe(true)
  })
})
