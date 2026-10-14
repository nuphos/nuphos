import assert from 'node:assert/strict'
import { test } from 'node:test'

import { signInArgs } from './cli-sign-in.ts'

test('the terminal sign-in runs the same commands as the desktop sign-in', () => {
  assert.deepEqual(signInArgs('claude-code'), ['auth', 'login', '--claudeai'])
  assert.deepEqual(signInArgs('codex'), [
    '-c',
    'cli_auth_credentials_store="file"',
    'login',
    '--device-auth',
  ])
})
