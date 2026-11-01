import assert from 'node:assert/strict'
import { test } from 'node:test'

import { REFRESH_MS, createStatsCache } from './agentStatsCache.ts'

import type { AgentStats, AgentStatsQuery } from '../../../types/team.ts'

const query: AgentStatsQuery = { range: '7d', scope: 'me', timeZone: 'UTC' }

function counting() {
  let calls = 0
  const fetchStats = () => {
    calls++

    return Promise.resolve({ calls } as unknown as AgentStats)
  }

  return { fetchStats, calls: () => calls }
}

test('two users never share an answer, even for the same team and query', async () => {
  const api = counting()
  const cache = createStatsCache(api.fetchStats, () => 0)

  const alice = await cache.load('alice', 'team', query)
  const bob = await cache.load('bob', 'team', query)

  assert.equal(api.calls(), 2)
  assert.notEqual(alice, bob)
})

test('one user asking the same again shares the request until it is stale', async () => {
  const api = counting()
  let clock = 0
  const cache = createStatsCache(api.fetchStats, () => clock)

  await cache.load('alice', 'team', query)
  await cache.load('alice', 'team', query)
  assert.equal(api.calls(), 1)
  clock = REFRESH_MS
  await cache.load('alice', 'team', query)
  assert.equal(api.calls(), 2)
})

test('clearing forgets every answer', async () => {
  const api = counting()
  const cache = createStatsCache(api.fetchStats, () => 0)

  await cache.load('alice', 'team', query)
  cache.clear()
  await cache.load('alice', 'team', query)
  assert.equal(api.calls(), 2)
})
