// Rows that share a sort time page like any others: none falls between two
// pages, none repeats. Auto-archive and archiving a tree stamp one archivedAt on
// many conversations at once.
// Runs when TEST_MONGODB_URI is set, with MONGODB_URI pointing at the same server.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { closeDb, connectDb } from '@/lib/db'

import { getConversations } from './conversations-list'
import { setupAgentIndexes } from './events'
import { agentConversations } from './shared'

const TEAM = new ObjectId().toHexString()
const ME = new ObjectId().toHexString()
const OWNER = new ObjectId().toHexString()
const BATCH = new Date('2026-11-01T00:00:00Z')
const LATER = new Date('2026-11-02T00:00:00Z')
const EARLIER = new Date('2026-10-01T00:00:00Z')

const row = (name: string, extra: Record<string, unknown>) => ({
  sessionId: `${TEAM}-${name}`,
  teamId: TEAM,
  userId: ME,
  title: name,
  createdAt: EARLIER,
  lastActiveAt: EARLIER,
  ...extra,
})
const many = (prefix: string, count: number, extra: Record<string, unknown>) =>
  Array.from({ length: count }, (_, i) => row(`${prefix}-${String(i)}`, extra))

async function walk(options: Omit<Parameters<typeof getConversations>[1], 'teamId'>) {
  const seen: string[] = []
  let cursor: string | undefined

  for (let pages = 0; pages < 20; pages++) {
    const page = await getConversations(ME, { teamId: TEAM, ...options, cursor })

    seen.push(...page.conversations.map((c) => c.sessionId.slice(TEAM.length + 1)))
    if (!page.hasMore) return seen
    cursor = page.nextCursor ?? undefined
  }
  throw new Error('paging did not end')
}

describe.skipIf(!process.env.TEST_MONGODB_URI)('conversation paging over tied sort times', () => {
  beforeAll(async () => {
    await connectDb()
    await setupAgentIndexes()
  })
  beforeEach(async () => {
    await agentConversations().deleteMany({ teamId: TEAM })
  })
  afterAll(async () => {
    await agentConversations().deleteMany({ teamId: TEAM })
    await closeDb()
  })

  test('an archive batch across a page boundary lists every row once, in order', async () => {
    await agentConversations().insertMany([
      row('newest', { archivedAt: LATER }),
      ...many('batch', 7, { archivedAt: BATCH }),
      row('oldest', { archivedAt: EARLIER }),
    ] as never)

    const seen = await walk({ sort: 'archived', limit: 3 })

    expect(seen).toHaveLength(9)
    expect(new Set(seen).size).toBe(9)
    expect(seen[0]).toBe('newest')
    expect(seen.at(-1)).toBe('oldest')
  })

  test('the shared Tasks I archived for myself merge into the same order', async () => {
    await agentConversations().insertMany([
      ...many('mine', 4, { archivedAt: BATCH }),
      ...many('shared', 4, {
        userId: OWNER,
        participantIds: [ME],
        memberArchivedAt: { [ME]: BATCH },
      }),
    ] as never)

    const seen = await walk({ sort: 'archived', limit: 3 })

    expect(seen).toHaveLength(8)
    expect(new Set(seen).size).toBe(8)
  })

  test('ties on activity and creation time page the same way', async () => {
    await agentConversations().insertMany(
      many('chat', 5, { lastActiveAt: BATCH, createdAt: BATCH }) as never,
    )

    for (const sort of ['activity', 'created'] as const) {
      const seen = await walk({ sort, limit: 2 })

      expect(seen).toHaveLength(5)
      expect(new Set(seen).size).toBe(5)
    }
  })

  test('a time-only cursor from an older client still pages strictly before it', async () => {
    await agentConversations().insertMany([
      row('newer', { archivedAt: LATER }),
      row('tied', { archivedAt: BATCH }),
      row('older', { archivedAt: EARLIER }),
    ] as never)

    const page = await getConversations(ME, {
      teamId: TEAM,
      sort: 'archived',
      cursor: BATCH.toISOString(),
    })

    expect(page.conversations.map((c) => c.title)).toEqual(['older'])
  })
})
