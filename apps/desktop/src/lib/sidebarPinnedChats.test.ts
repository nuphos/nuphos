import assert from 'node:assert/strict'
import test from 'node:test'

import { favoriteSessionId, partitionPinnedChats } from './sidebarPinnedChats.ts'

test('favoriteSessionId reads a chat row key', () => {
  assert.equal(favoriteSessionId({ key: 'agent-session:abc' }), 'abc')
  assert.equal(favoriteSessionId({ key: 'agent-session:' }), null)
  assert.equal(favoriteSessionId({ key: 'team.plans' }), null)
})

test('favoriteSessionId reads an agent page href', () => {
  assert.equal(favoriteSessionId({ href: '/teams/t1/agent/sess-1' }), 'sess-1')
  assert.equal(favoriteSessionId({ href: '/teams/t1/chats/sess-2' }), 'sess-2')
  assert.equal(favoriteSessionId({ key: 'fav-href:/teams/t1/agent/sess-3' }), 'sess-3')
  assert.equal(favoriteSessionId({ href: '/teams/t1/agent' }), null)
  assert.equal(favoriteSessionId({ href: '/teams/t1/agent/memories' }), null)
  assert.equal(favoriteSessionId({ href: '/teams/t1/plans' }), null)
  assert.equal(favoriteSessionId({}), null)
})

test('partitionPinnedChats keeps store order within each group', () => {
  const favorites = [
    { entry: { href: '/teams/t1/plans' } },
    { entry: { href: '/teams/t1/agent/s1' } },
    { entry: { key: 'agent-session:s2' } },
    { entry: { key: 'team.triggers' } },
  ]
  const { pinnedChats, others } = partitionPinnedChats(favorites)

  assert.deepEqual(pinnedChats, [favorites[1], favorites[2]])
  assert.deepEqual(others, [favorites[0], favorites[3]])
})
