import assert from 'node:assert/strict'
import test from 'node:test'

import { chatRowAccess } from './chat-row-access.ts'

test('an own agent keeps every action', () => {
  assert.deepEqual(chatRowAccess({ isOwner: true, canManage: true }), {})
})

test('an agent shared with the viewer is read only, and archivable only when managed', () => {
  assert.deepEqual(chatRowAccess({ isOwner: false, canManage: false }), { readOnlyChat: true })
  assert.deepEqual(chatRowAccess({ isOwner: false, canManage: true }), {
    readOnlyChat: true,
    managedChat: true,
  })
})

test('a group chat is left by a member and kept whole for its owner', () => {
  assert.deepEqual(chatRowAccess({ kind: 'channel', isOwner: false }), { joinedChat: true })
  assert.deepEqual(chatRowAccess({ kind: 'channel', isOwner: true }), {})
})

test('a row without ownership data is left as it was', () => {
  assert.deepEqual(chatRowAccess({}), {})
  assert.deepEqual(chatRowAccess({ kind: 'channel' }), {})
})
