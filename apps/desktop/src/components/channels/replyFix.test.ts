import assert from 'node:assert/strict'
import { test } from 'node:test'

import { replyFix } from './replyFix.ts'

const team = { personalAgent: false, canOpenSettings: false }
const admin = { personalAgent: false, canOpenSettings: true }

test('a sign-in that ran out signs in again where the viewer can', () => {
  assert.equal(replyFix('auth', 'cli', team), 'signIn')
  assert.equal(replyFix('auth', 'dialog', admin), 'signIn')
})

test('someone else signs it in: the line says whom to ask', () => {
  assert.equal(replyFix('auth', 'ask', team), 'ask')
})

test('an administrator repairs a team runtime from its settings', () => {
  assert.equal(replyFix('auth', 'none', admin), 'settings')
  assert.equal(replyFix('offline', 'none', admin), 'settings')
  assert.equal(replyFix('offline', 'none', team), null)
  // A computer's own agent is repaired on that computer, not in team settings.
  assert.equal(replyFix('offline', 'none', { personalAgent: true, canOpenSettings: true }), null)
})

test('a usage limit or another failure offers no repair of its own', () => {
  assert.equal(replyFix('usage_limit', 'dialog', admin), null)
  assert.equal(replyFix('other', 'cli', admin), null)
  assert.equal(replyFix(undefined, 'cli', admin), null)
})
