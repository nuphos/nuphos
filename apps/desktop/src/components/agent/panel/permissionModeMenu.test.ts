import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ownsPermissionMode } from './permissionModeMenu.ts'

test("a Task under a Bot has no permission mode menu; the Bot's own chat keeps it", () => {
  assert.equal(ownsPermissionMode({ sessionId: 'bot' }), true)
  assert.equal(
    ownsPermissionMode({ sessionId: 'task', credentialSource: { sessionId: 'bot' } }),
    false,
  )
})

test('a read-only or unmanaged shared chat still has no menu', () => {
  assert.equal(ownsPermissionMode({ sessionId: 'chat', readOnly: true }), false)
  assert.equal(ownsPermissionMode({ sessionId: 'chat', foreign: true }), false)
  assert.equal(ownsPermissionMode({ sessionId: 'chat', foreign: true, canManage: true }), true)
  assert.equal(ownsPermissionMode({ sessionId: '' }), false)
})
