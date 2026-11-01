import assert from 'node:assert/strict'
import { test } from 'node:test'

import { teamMembersRequest } from './teamMembersRequest.ts'

import type { TeamMember } from '../types/team.ts'

const member = (id: string): TeamMember =>
  ({
    id,
    name: id,
    email: `${id}@example.com`,
    username: id,
    role: 'ADMINISTRATOR',
    joinedAt: '2025-01-01T00:00:00Z',
  }) as TeamMember

test('every view asking for one team shares a single read', async () => {
  const cache = new Map()
  let reads = 0
  const read = async () => {
    reads++

    return [member('a')]
  }

  await Promise.all([1, 2, 3, 4].map(() => teamMembersRequest('t1', read, 0, cache)))
  assert.equal(reads, 1)
})

test("one team's members never answer for another team", async () => {
  const cache = new Map()
  const read = async (teamId: string) => [member(`admin-of-${teamId}`)]

  assert.equal((await teamMembersRequest('t1', read, 0, cache))?.[0]?.id, 'admin-of-t1')
  assert.equal((await teamMembersRequest('t2', read, 0, cache))?.[0]?.id, 'admin-of-t2')
})

test('a failed read is dropped and asked again; a stale one is re-read', async () => {
  const cache = new Map()
  let reads = 0
  const flaky = async () => {
    reads++
    if (reads === 1) throw new Error('503')

    return [member('a')]
  }

  assert.equal(await teamMembersRequest('t1', flaky, 0, cache), null)
  assert.equal((await teamMembersRequest('t1', flaky, 1, cache))?.length, 1)
  await teamMembersRequest('t1', flaky, 120_000, cache)
  assert.equal(reads, 3)
})
