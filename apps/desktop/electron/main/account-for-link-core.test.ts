import assert from 'node:assert/strict'
import { test } from 'node:test'

import { accountForTeam, teamOfPath } from './account-for-link-core.ts'

import type { AccountSummary } from '../auth/accounts.ts'

const a: AccountSummary = {
  key: 'a@https://api.nuphos.ai',
  api: 'https://api.nuphos.ai',
  active: true,
}
const b: AccountSummary = {
  key: 'b@https://api.nuphos.ai',
  api: 'https://api.nuphos.ai',
  active: false,
}
const c: AccountSummary = {
  key: 'c@https://nuphos.example.com',
  api: 'https://nuphos.example.com',
  active: false,
}
const teams: Record<string, string[]> = { [b.key]: ['team-b'], [c.key]: ['team-c'] }

function deps(activeTeams: () => Promise<string[]> = async () => ['team-a']) {
  const asked: string[] = []

  return {
    asked,
    deps: {
      activeTeams,
      accounts: async () => [a, b, c],
      teamsOf: async (account: AccountSummary) => {
        asked.push(account.key)
        if (account.key === b.key && teamsOfBFails) throw new Error('offline')

        return teams[account.key] ?? []
      },
    },
  }
}
let teamsOfBFails = false

test('a page path names its team', () => {
  assert.equal(teamOfPath('/teams/team-a/agent/s1'), 'team-a')
  assert.equal(teamOfPath('/teams/team-a?x=1'), 'team-a')
  assert.equal(teamOfPath('/settings'), null)
})

test('a team of the account in use opens there, asking no other backend', async () => {
  const h = deps()

  assert.equal(await accountForTeam('team-a', h.deps), null)
  assert.deepEqual(h.asked, [])
})

test('a team only another signed-in account is in switches to that account', async () => {
  assert.equal(await accountForTeam('team-b', deps().deps), b.key)
  assert.equal(await accountForTeam('team-c', deps().deps), c.key)
})

test('a team no account here is in, or an unreachable backend, switches nothing', async () => {
  assert.equal(await accountForTeam('team-x', deps().deps), null)
  teamsOfBFails = true
  assert.equal(await accountForTeam('team-b', deps().deps), null)
  teamsOfBFails = false
  // The account in use cannot list its teams: it keeps the link, as before.
  const offline = deps(async () => {
    throw new Error('offline')
  })

  assert.equal(await accountForTeam('team-b', offline.deps), null)
})
