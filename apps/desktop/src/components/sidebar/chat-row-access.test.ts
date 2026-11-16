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

test('a channel and a row without ownership data are left as they were', () => {
  assert.deepEqual(chatRowAccess({ kind: 'channel', isOwner: false }), {})
  assert.deepEqual(chatRowAccess({}), {})
})
