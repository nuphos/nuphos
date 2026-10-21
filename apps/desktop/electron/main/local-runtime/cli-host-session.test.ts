import assert from 'node:assert/strict'
import { test } from 'node:test'

import { cliSessionToken, hostOwner } from './cli-host-session.ts'

const launch = { token: 'nup_launch', keychainAccount: 'u1@https://api.nuphos.ai' }

test('a device-login token in cli.yaml is the session, though it is not a JWT', () => {
  assert.equal(cliSessionToken({ token: 'nup_saved' }, launch), 'nup_saved')
})

test('the launch token is the session while cli.yaml names its keychain item', () => {
  assert.equal(cliSessionToken({ keychainAccount: launch.keychainAccount }, launch), 'nup_launch')
  // Signed out, or signed in as someone else since: not any more.
  assert.equal(cliSessionToken({}, launch), null)
  assert.equal(cliSessionToken({ keychainAccount: 'u2@https://api.nuphos.ai' }, launch), null)
  assert.equal(cliSessionToken(null, launch), null)
})

test('the owner comes from /auth/me, and an agent token is refused', () => {
  assert.deepEqual(hostOwner({ id: 'u1', cliToken: { kind: 'personal' } }), { userId: 'u1' })
  assert.deepEqual(hostOwner({ id: 'u1' }), { userId: 'u1' })
  assert.match(
    (hostOwner({ id: 'u1', cliToken: { kind: 'agent' } }) as { error: string }).error,
    /agent token/,
  )
  assert.match((hostOwner(null) as { error: string }).error, /Not signed in/)
})
