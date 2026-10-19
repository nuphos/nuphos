import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { personalIdentityRow, setPersonalIdentity } from './personalIdentity.ts'

import type { AgentCredentialSelection } from '../../../api'

// Only teamIdentity matters here; the access lists are untouched.
const emptyCredentialAccess = () => ({ githubInstallationIds: ['i1'] }) as AgentCredentialSelection

const github = { provider: 'github' as const, login: 'fong', workspaceName: null, connectedAt: 'x' }
const linear = {
  provider: 'linear' as const,
  login: 'fong',
  workspaceName: 'Zeabur',
  connectedAt: 'x',
}

describe('personal identity row', () => {
  test('a connected provider is ticked by default', () => {
    assert.deepEqual(personalIdentityRow('github', [github], emptyCredentialAccess()), {
      provider: 'github',
      label: 'You (fong) · Personal',
      checked: true,
    })
  })

  test('unticking puts the provider in teamIdentity, ticking removes it', () => {
    const team = setPersonalIdentity(emptyCredentialAccess(), 'linear', false)

    assert.deepEqual(team.teamIdentity, ['linear'])
    const row = personalIdentityRow('linear', [linear], team)

    assert.equal(row?.checked, false)
    assert.deepEqual(setPersonalIdentity(team, 'linear', true).teamIdentity, [])
  })

  test('a provider the member has not connected has no row', () => {
    assert.equal(personalIdentityRow('linear', [github], emptyCredentialAccess()), null)
  })
})
