import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  personalIdentityRow,
  personalRows,
  setAllPersonal,
  setPersonalIdentity,
  setPersonalOnly,
  teamIdentityOf,
} from './personalIdentity.ts'

import { EMPTY_CREDENTIAL_OPTIONS } from './constants.ts'
import { defaultCredentialAccess } from './credentialAccess.ts'

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
      label: 'Team connection acts as you (fong)',
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

  test('every drawn own row is counted: the credential, and the identity under a binding', () => {
    const rows = personalRows(options(1, 0), {
      ...emptyCredentialAccess(),
      personalCredentialIds: ['linear'],
    })

    assert.deepEqual(rows, [
      { provider: 'github', identity: false, checked: false },
      { provider: 'github', identity: true, checked: true },
      { provider: 'linear', identity: false, checked: true },
    ])
    assert.deepEqual(
      personalRows(options(1, 0), { ...emptyCredentialAccess(), teamIdentity: ['github'] }).map(
        (row) => row.checked,
      ),
      [false, false, false],
    )
  })

  test('Select all ticks every own row and Clear all unticks them', () => {
    const rows = personalRows(options(1, 0), emptyCredentialAccess())

    assert.deepEqual(setAllPersonal(emptyCredentialAccess(), rows, true), {
      teamIdentity: [],
      personalCredentialIds: ['github', 'linear'],
    })
    assert.deepEqual(setAllPersonal(emptyCredentialAccess(), rows, false), {
      teamIdentity: ['github'],
      personalCredentialIds: [],
    })
  })

  // The backend keeps the stored value for any key a selection omits, so an
  // emptied teamIdentity must be sent as [] or "act as me" never takes effect.
  test('Select all sends an empty teamIdentity instead of omitting it', () => {
    const value = { ...emptyCredentialAccess(), teamIdentity: ['github' as const] }
    const selected = setAllPersonal(value, personalRows(options(1, 0), value), true)

    assert.deepEqual(selected.teamIdentity, [])
    assert.deepEqual(teamIdentityOf(selected).teamIdentity, [])
  })

  // #1928: with the team's binding already acting as the member, Select all left
  // "You (login) · Personal" unticked while the badge read N/N.
  test('under a binding, Select all ticks the own credential too', () => {
    for (const provider of ['github', 'linear'] as const) {
      const bound = provider === 'github' ? options(1, 0) : options(0, 1)
      const value = emptyCredentialAccess()
      const selected = { ...value, ...setAllPersonal(value, personalRows(bound, value), true) }

      assert.deepEqual(selected.personalCredentialIds?.sort(), ['github', 'linear'])
      assert.ok(personalRows(bound, selected).every((row) => row.checked))
      assert.deepEqual(
        setAllPersonal(selected, personalRows(bound, selected), false).personalCredentialIds,
        [],
      )
    }
  })

  test('opting in or out of the own credential never touches teamIdentity', () => {
    for (const provider of ['github', 'linear'] as const) {
      for (const teamIdentity of [undefined, [provider]]) {
        const value = { ...emptyCredentialAccess(), ...(teamIdentity ? { teamIdentity } : {}) }
        const ticked = setPersonalOnly(value, provider, true)

        assert.deepEqual(ticked.personalCredentialIds, [provider])
        assert.deepEqual(ticked.teamIdentity, value.teamIdentity)
        assert.deepEqual(setPersonalOnly(ticked, provider, false).teamIdentity, value.teamIdentity)
      }
    }
  })

  test("a new chat's default selection never includes the member's own credential", () => {
    const loaded = {
      ...EMPTY_CREDENTIAL_OPTIONS,
      githubInstallations: [
        { installationId: 'i1', accountLogin: 'acme', accountType: 'Organization' },
      ],
      personalCredentials: own,
    } as AgentCredentialOptions

    assert.deepEqual(defaultCredentialAccess(loaded).personalCredentialIds ?? [], [])
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
    assert.deepEqual(teamIdentityOf({ personalCredentialIds: [] }), { personalCredentialIds: [] })
  })
})
