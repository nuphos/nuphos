import assert from 'node:assert/strict'
import { test } from 'node:test'

import { personalConnectorOpens } from './personalConnectorOpens.ts'

const github = { provider: 'github', login: 'octo' } as never

test('Connect on a personal connector connects in place', () => {
  assert.equal(personalConnectorOpens(undefined, 'github', null), 'connect')
  assert.equal(
    personalConnectorOpens(undefined, 'gmail', { clientId: 'c1', composio: false }),
    'connect',
  )
  // Through Composio when the team has no client of its own.
  assert.equal(
    personalConnectorOpens(undefined, 'gmail', { clientId: null, composio: true }),
    'connect',
  )
})

test('a connected account, or Google without any client, opens its settings', () => {
  assert.equal(personalConnectorOpens(github, 'github', null), 'settings')
  // The note on who adds the client lives in Settings.
  assert.equal(
    personalConnectorOpens(undefined, 'gmail', { clientId: null, composio: false }),
    'settings',
  )
})
