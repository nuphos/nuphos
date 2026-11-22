// Someone who does not own a shared Task archives it for themselves only.
// Runs when TEST_MONGODB_URI is set, with MONGODB_URI pointing at the same server.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { closeDb, connectDb } from '@/lib/db'

import { setMemberArchived } from './archive'
import { getConversations } from './conversations-list'
import { setupAgentIndexes } from './events'
import { agentConversations } from './shared'

const TEAM = new ObjectId().toHexString()
const OWNER = new ObjectId().toHexString()
const ME = new ObjectId().toHexString()
const OTHER = new ObjectId().toHexString()
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000)

const task = (sessionId: string, userId: string, extra: Record<string, unknown> = {}) => ({
  sessionId: `${TEAM}-${sessionId}`,
  teamId: TEAM,
  userId,
  title: sessionId,
  lastActiveAt: minutesAgo(1),
  createdAt: minutesAgo(60),
  ...(userId === ME ? {} : { participantIds: [ME, OTHER] }),
  ...extra,
})

const ids = (rows: { sessionId: string }[]) =>
  rows.map((row) => row.sessionId.slice(TEAM.length + 1))
const sidebar = async (viewer: string, scope: 'mine' | 'shared') =>
  ids((await getConversations(viewer, { teamId: TEAM, scope, archived: 'exclude' })).conversations)

describe.skipIf(!process.env.TEST_MONGODB_URI)('archiving a shared Task for yourself', () => {
  beforeAll(async () => {
    await connectDb()
    await setupAgentIndexes()
    await agentConversations().insertMany([
      task('shared', OWNER),
      task('shared-older', OWNER, { lastActiveAt: minutesAgo(2) }),
      task('mine-archived', ME, { archivedAt: minutesAgo(20) }),
      task('mine-archived-latest', ME, { archivedAt: minutesAgo(5) }),
    ] as never)
  })
  afterAll(async () => {
    await agentConversations().deleteMany({ teamId: TEAM })
    await closeDb()
  })

  test('it leaves my lists, and no one else sees a change', async () => {
    await setMemberArchived(`${TEAM}-shared-older`, ME, true)
    await Bun.sleep(5)
    await setMemberArchived(`${TEAM}-shared`, ME, true)

    expect(await sidebar(ME, 'shared')).toEqual([])
    expect(await sidebar(OTHER, 'shared')).toEqual(['shared', 'shared-older'])
    expect(await sidebar(OWNER, 'mine')).toEqual(['shared', 'shared-older'])
    const stored = await agentConversations().findOne({ sessionId: `${TEAM}-shared` })

    expect(stored?.participantIds).toEqual([ME, OTHER])
    expect(stored?.archivedAt).toBeUndefined()
  })

  test('my Archived lists it with my own, by when I archived each, a page at a time', async () => {
    const archived = (cursor?: string) =>
      getConversations(ME, {
        teamId: TEAM,
        scope: 'mine',
        sort: 'archived',
        limit: 2,
        ...(cursor ? { cursor } : {}),
      })
    const first = await archived()
    const second = await archived(first.nextCursor ?? undefined)

    expect(ids(first.conversations)).toEqual(['shared', 'shared-older'])
    expect(ids(second.conversations)).toEqual(['mine-archived-latest', 'mine-archived'])
    expect(second.hasMore).toBe(false)
    // The owner's Archived is theirs alone.
    expect(
      (await getConversations(OWNER, { teamId: TEAM, scope: 'mine', sort: 'archived' }))
        .conversations,
    ).toEqual([])
  })

  test('restoring it brings it back to my list', async () => {
    await setMemberArchived(`${TEAM}-shared`, ME, false)

    expect(await sidebar(ME, 'shared')).toEqual(['shared'])
  })
})
