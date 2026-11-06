import assert from 'node:assert/strict'
import test from 'node:test'

import { favoriteSessionId } from './sidebarPinnedChats.ts'

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
