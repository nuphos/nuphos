// Which names each role gets for the ids a usage query groups by, against a real database.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { closeDb, connectDb } from '@/lib/db'
import { teams, users } from '@/lib/identity/shared'

import { agentConversations } from './db'
import { agentDevices } from './devices/store'
import { agentTriggers } from './trigger-db'
import { usageNames } from './usage-names'

import type { UsageDimension, UsageQueryRow } from './usage-query'

const TEAM = new ObjectId()
const OTHER_TEAM = new ObjectId().toHexString()
const ADMIN = new ObjectId()
const MEMBER = new ObjectId()
const LEFT = new ObjectId()
const teamId = TEAM.toHexString()
const [admin, member, left] = [ADMIN, MEMBER, LEFT].map((id) => id.toHexString()) as [
  string,
  string,
  string,
]
const ADMIN_BOT = `${teamId}-bot`
const ADMIN_TASK = `${teamId}-task`
const MEMBER_CHAT = `${teamId}-chat`
const ADMIN_TRIGGER = new ObjectId()
const MEMBER_TRIGGER = new ObjectId()
const ELSEWHERE_TRIGGER = new ObjectId()

const asAdmin = { userId: admin, teamRole: 'ADMINISTRATOR' as const }
const asMember = { userId: member, teamRole: 'EDITOR' as const }

/** The names `viewer` gets for these ids, grouped by `dimension`. */
const names = async (
  viewer: typeof asAdmin | typeof asMember,
  dimension: UsageDimension,
  ids: string[],
) =>
  (
    await usageNames(
      teamId,
      viewer,
      [dimension],
      ids.map((id) => ({ keys: { [dimension]: id } }) as UsageQueryRow),
    )
  )[dimension]

describe.skipIf(!process.env.TEST_MONGODB_URI)('usage names', () => {
  beforeAll(async () => {
    await connectDb()
    const createdAt = new Date('2026-11-01T00:00:00Z')

    await users().insertMany([
      { _id: ADMIN, email: 'admin@example.com', name: 'Ada', createdAt },
      { _id: MEMBER, email: 'member@example.com', name: '', createdAt },
      { _id: LEFT, email: 'left@example.com', name: 'Lee', createdAt },
    ] as never)
    await teams().insertOne({
      _id: TEAM,
      name: 'Usage names',
      members: [
        { userId: ADMIN, role: 'ADMINISTRATOR', joinedAt: createdAt },
        { userId: MEMBER, role: 'EDITOR', joinedAt: createdAt },
        { userId: LEFT, role: 'EDITOR', joinedAt: createdAt, deletedAt: createdAt },
      ],
    } as never)
    await agentConversations().insertMany([
      { sessionId: ADMIN_BOT, teamId, userId: admin, title: 'Release Bot', avatar: '05-rembrandt' },
      {
        sessionId: ADMIN_TASK,
        teamId,
        userId: admin,
        title: 'Archived Task',
        parentSessionId: ADMIN_BOT,
        archivedAt: createdAt,
      },
      { sessionId: MEMBER_CHAT, teamId, userId: member, title: 'My chat' },
    ] as never)
    await agentTriggers().insertMany([
      { _id: ADMIN_TRIGGER, teamId, userId: admin, name: 'Nightly', targetSessionId: ADMIN_BOT },
      { _id: MEMBER_TRIGGER, teamId, userId: member, name: 'Mine', targetSessionId: MEMBER_CHAT },
      { _id: ELSEWHERE_TRIGGER, teamId: OTHER_TEAM, userId: admin, name: 'Elsewhere' },
    ] as never)
    await agentDevices().insertMany([
      { deviceId: `${teamId}-mac`, teamId, userId: admin, userIds: [admin], label: "Ada's Mac" },
      { deviceId: `${teamId}-box`, teamId, userId: admin, userIds: [admin, member], label: 'Box' },
    ] as never)
  })

  afterAll(async () => {
    await users().deleteMany({ _id: { $in: [ADMIN, MEMBER, LEFT] } })
    await teams().deleteOne({ _id: TEAM })
    await agentConversations().deleteMany({ teamId })
    await agentTriggers().deleteMany({
      _id: { $in: [ADMIN_TRIGGER, MEMBER_TRIGGER, ELSEWHERE_TRIGGER] },
    })
    await agentDevices().deleteMany({ teamId })
    await closeDb()
  })

  test('people are named to everyone, including someone who left', async () => {
    for (const viewer of [asAdmin, asMember])
      expect(await names(viewer, 'member', [admin, member, left])).toEqual({
        [admin]: 'Ada',
        [member]: 'member@example.com',
        [left]: 'Lee',
      })
  })

  test('a Bot and its archived Task are named to an administrator, not to another member', async () => {
    expect(await names(asAdmin, 'bot', [ADMIN_BOT])).toEqual({ [ADMIN_BOT]: 'Release Bot' })
    expect(await names(asAdmin, 'task', [ADMIN_TASK])).toEqual({ [ADMIN_TASK]: 'Archived Task' })
    expect(await names(asMember, 'bot', [ADMIN_BOT])).toEqual({ [ADMIN_BOT]: null })
    expect(await names(asMember, 'task', [ADMIN_TASK])).toEqual({ [ADMIN_TASK]: null })
    expect(await names(asMember, 'conversation', [MEMBER_CHAT])).toEqual({
      [MEMBER_CHAT]: 'My chat',
    })
  })

  test('Triggers and computers are the team’s: named to every member, never from another team', async () => {
    const triggers = [ADMIN_TRIGGER, MEMBER_TRIGGER, ELSEWHERE_TRIGGER].map((id) =>
      id.toHexString(),
    )
    const computers = [`${teamId}-mac`, `${teamId}-box`, 'not-a-computer']

    for (const viewer of [asAdmin, asMember]) {
      expect(await names(viewer, 'trigger', triggers)).toEqual({
        [triggers[0]!]: 'Nightly',
        [triggers[1]!]: 'Mine',
      })
      expect(await names(viewer, 'computer', computers)).toEqual({
        [`${teamId}-mac`]: "Ada's Mac",
        [`${teamId}-box`]: 'Box',
      })
    }
  })
})
