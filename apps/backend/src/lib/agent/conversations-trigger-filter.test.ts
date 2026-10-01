import { describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import { getConversations } from './db'

import type * as dbActual from '@/lib/db'

// Trigger-fired conversations belong to their Trigger, not to Chats. Both
// halves of that live in this one query, so they are pinned together: omitting
// `triggerIds` must EXCLUDE every trigger-stamped conversation, and passing it
// must return only those. A backend that ignores the option answers 200 with a
// plausible list either way — the desktop cannot tell the difference, so the
// Trigger's Runs list would silently show the whole team's chats.

let lastQuery: Record<string, unknown> | undefined

const collection = {
  find(query: Record<string, unknown>) {
    lastQuery = query

    return {
      sort: () => ({ limit: () => ({ toArray: async () => [] }) }),
    }
  },
}

useDb({ db: (() => ({ collection: () => collection })) as unknown as typeof dbActual.db })

const TEAM = '69e989027ab63e8d6a0ffcb6'
const VIEWER = '642802f4c38340345aa2384d'
const TRIGGER = '6512f0a1b2c3d4e5f6a7b8c9'
const OTHER_TRIGGER = '6512f0a1b2c3d4e5f6a7b8ca'

async function queryFor(options: Parameters<typeof getConversations>[1]) {
  lastQuery = undefined
  await getConversations(VIEWER, options)

  return lastQuery!
}

describe('getConversations trigger filter', () => {
  test('the unfiltered list excludes every trigger-stamped conversation', async () => {
    expect(await queryFor({ teamId: TEAM, scope: 'team' })).toEqual({
      teamId: TEAM,
      'metadata.trigger.id': { $exists: false },
    })
  })

  test('a triggerId returns that trigger runs and nothing else', async () => {
    expect(await queryFor({ teamId: TEAM, scope: 'team', triggerIds: [TRIGGER] })).toEqual({
      teamId: TEAM,
      'metadata.trigger.id': { $in: [TRIGGER] },
    })
  })

  test('several triggerIds list a Watch group members runs together', async () => {
    expect(
      await queryFor({ teamId: TEAM, scope: 'team', triggerIds: [TRIGGER, OTHER_TRIGGER] }),
    ).toEqual({
      teamId: TEAM,
      'metadata.trigger.id': { $in: [TRIGGER, OTHER_TRIGGER] },
    })
  })

  test('no triggerIds at all matches nothing rather than falling back to Chats', async () => {
    expect(await queryFor({ teamId: TEAM, scope: 'team', triggerIds: [] })).toEqual({
      teamId: TEAM,
      'metadata.trigger.id': { $in: [] },
    })
  })

  test('a trigger listing still honours search and the cursor', async () => {
    const query = await queryFor({
      teamId: TEAM,
      scope: 'team',
      triggerIds: [TRIGGER],
      search: 'cost',
      cursor: '2026-08-03T00:00:00.000Z',
    })

    expect(query['metadata.trigger.id']).toEqual({ $in: [TRIGGER] })
    expect(query.lastActiveAt).toEqual({ $lt: new Date('2026-08-03T00:00:00.000Z') })
    expect(query.$or).toBeDefined()
  })
})
