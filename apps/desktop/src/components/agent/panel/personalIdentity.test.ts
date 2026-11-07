import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  personalIdentityRow,
  personalOnlyCredentials,
  setPersonalIdentity,
  setPersonalOnly,
  teamIdentityOf,
} from './personalIdentity.ts'

import type { AgentCredentialOptions } from '../../../api'

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

describe('own credential without a team binding', () => {
  const own = [
    { provider: 'github' as const, login: 'fong' },
    { provider: 'linear' as const, login: 'fong' },
  ]
  const options = (github: number, linear: number) =>
    ({
      personalCredentials: own,
      githubInstallations: Array.from({ length: github }, () => ({})),
      linearWorkspaces: Array.from({ length: linear }, () => ({})),
    }) as unknown as AgentCredentialOptions

  test('offered only for a provider the team has no binding of', () => {
    assert.deepEqual(personalOnlyCredentials(options(0, 0)), own)
    assert.deepEqual(personalOnlyCredentials(options(1, 0)), [own[1]])
    assert.deepEqual(personalOnlyCredentials(options(1, 1)), [])
  })

  test('ticking adds the provider and unticking removes only it', () => {
    const ticked = setPersonalOnly(
      setPersonalOnly(emptyCredentialAccess(), 'github', true),
      'linear',
      true,
    )

    assert.deepEqual(ticked.personalCredentialIds, ['github', 'linear'])
    assert.deepEqual(setPersonalOnly(ticked, 'github', false).personalCredentialIds, ['linear'])
    assert.deepEqual(ticked.githubInstallationIds, ['i1'])
  })

  test('carried through normalize and prune like teamIdentity', () => {
    assert.deepEqual(teamIdentityOf({ personalCredentialIds: ['linear'] }), {
      personalCredentialIds: ['linear'],
    })
    assert.deepEqual(teamIdentityOf({ personalCredentialIds: [] }), {})
  })
})
