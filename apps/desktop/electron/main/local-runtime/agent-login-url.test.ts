import assert from 'node:assert/strict'
import { test } from 'node:test'

import { claudeLoginUrl } from './agent-login.ts'

test('recognizes the current Claude authorization path and rejects lookalikes', () => {
  assert.equal(
    claudeLoginUrl('https://claude.com/cai/oauth/authorize?state=test'),
    'https://claude.com/cai/oauth/authorize?state=test',
  )
  assert.equal(claudeLoginUrl('https://claude.com.evil.test/cai/oauth/authorize'), undefined)
  assert.equal(claudeLoginUrl('https://claude.com/cai/oauth/authorize/other'), undefined)
})
