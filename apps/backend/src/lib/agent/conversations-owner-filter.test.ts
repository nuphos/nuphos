import { describe, expect, mock, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import { readableByFilter } from './db/access'
import { getConversations } from './db'

import type * as dbActual from '@/lib/db'

// The Chats reader filters the list to one team member. That filter has to be
// part of the query, not a slice of the page the client already holds, or
// cursor pagination hands back short pages that look like "no more results".
// This pins the query the filter actually builds — the desktop can't tell a
// backend that ignores `ownerId` from one that honours it: both answer 200
// with a list, and the wrong one silently shows everybody.

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

const TEAM = '64b5f1c2e4b0a1d2c3e4f5a6'
const VIEWER = '642802f4c38340345aa2384d'
const READABLE = { $and: [readableByFilter(VIEWER)] }
const OTHER = '62e6289482f5f9d9408f1a79'

async function queryFor(options: Parameters<typeof getConversations>[1]) {
  lastQuery = undefined
  await getConversations(VIEWER, options)

  return lastQuery!
}

// Every listing here is a Chats listing, so it also carries the trigger
// exclusion — pinned in conversations-trigger-filter.test.ts, and spelled out
// in these expectations so the two can't drift apart silently.
const NO_TRIGGER_RUNS = { 'metadata.trigger.id': { $exists: false } }

describe('getConversations ownerId filter', () => {
  test('team scope without an owner lists the whole team', async () => {
    expect(await queryFor({ teamId: TEAM, scope: 'team' })).toEqual({
      teamId: TEAM,
      ...READABLE,
      ...NO_TRIGGER_RUNS,
    })
  })

  test('an owner narrows team scope to that member', async () => {
    expect(await queryFor({ teamId: TEAM, scope: 'team', ownerId: OTHER })).toEqual({
      teamId: TEAM,
      ...READABLE,
      userId: OTHER,
      ...NO_TRIGGER_RUNS,
    })
  })

  test('picking yourself is the same query as the old "mine" scope', async () => {
    const mine = await queryFor({ teamId: TEAM, scope: 'mine' })
    const self = await queryFor({ teamId: TEAM, scope: 'team', ownerId: VIEWER })

    expect(self).toEqual(mine)
  })

  test('mine scope ignores an owner rather than listing someone else', async () => {
    // 'mine' is the viewer by definition; honouring ownerId there would let a
    // narrower scope widen into another member's conversations.
    expect(await queryFor({ teamId: TEAM, scope: 'mine', ownerId: OTHER })).toEqual({
      teamId: TEAM,
      ...READABLE,
      userId: VIEWER,
      ...NO_TRIGGER_RUNS,
    })
  })

  test('the owner filter composes with search and the archived filter', async () => {
    const query = await queryFor({
      teamId: TEAM,
      ...READABLE,
      scope: 'team',
      ownerId: OTHER,
      search: 'deploy',
      archived: 'exclude',
    })

    expect(query.userId).toBe(OTHER)
    expect(query.archivedAt).toEqual({ $exists: false })
    expect(Array.isArray(query.$or)).toBe(true)
  })
})

// The sidebar's Shared section. It must be the exact complement of 'mine'
// within a team: joined by the viewer, owned by someone else. Anything looser
// (dropping the owner exclusion) would list the viewer's own chats twice — once
// under Chats and again under Shared.
describe('getConversations shared scope', () => {
  test('asks for conversations the viewer joined but does not own', async () => {
    expect(await queryFor({ teamId: TEAM, scope: 'shared' })).toEqual({
      teamId: TEAM,
      ...READABLE,
      participantIds: VIEWER,
      userId: { $ne: VIEWER },
      ...NO_TRIGGER_RUNS,
    })
  })

  test('an owner filter cannot redirect it at someone else', async () => {
    expect(await queryFor({ teamId: TEAM, scope: 'shared', ownerId: OTHER })).toEqual({
      teamId: TEAM,
      ...READABLE,
      participantIds: VIEWER,
      userId: { $ne: VIEWER },
      ...NO_TRIGGER_RUNS,
    })
  })

  test('composes with the archived exclusion the sidebar asks for', async () => {
    const query = await queryFor({
      teamId: TEAM,
      ...READABLE,
      scope: 'shared',
      archived: 'exclude',
      sort: 'created',
    })

    expect(query.participantIds).toBe(VIEWER)
    expect(query.userId).toEqual({ $ne: VIEWER })
    expect(query.archivedAt).toEqual({ $exists: false })
  })
})
