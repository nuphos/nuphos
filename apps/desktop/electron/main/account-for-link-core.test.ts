import assert from 'node:assert/strict'
import { test } from 'node:test'

import { accountForTeam, oneAtATime, switchThenWait, teamOfPath } from './account-for-link-core.ts'

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

test('every waiting account is asked at once, and the first in the list that is in the team wins', async () => {
  const started: string[] = []
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const routing = accountForTeam('team-c', {
    activeTeams: async () => ['team-a'],
    accounts: async () => [a, b, c],
    teamsOf: async (account) => {
      started.push(account.key)
      await gate

      return teams[account.key] ?? []
    },
  })

  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(started, [b.key, c.key], 'both asked before either answers')
  release()
  assert.equal(await routing, c.key)
})

function switching(outcome: 'switched' | 'signInAgain' | null, reloads: boolean) {
  const waiting = new Set<() => void>()

  return {
    waiting,
    deps: {
      switchAccount: async () => {
        if (reloads) setImmediate(() => [...waiting].forEach((resolve) => resolve()))
        if (outcome === null) throw new Error('write failed')

        return outcome
      },
      nextReload: () => {
        let resolve!: () => void
        const reloaded = new Promise<void>((r) => {
          resolve = r
        })

        waiting.add(resolve)

        return { reloaded, cancel: () => waiting.delete(resolve) }
      },
      waitMs: 5_000,
    },
  }
}

test('a switch resolves once the windows reload as the next account', async () => {
  const h = switching('switched', true)

  assert.equal(await switchThenWait(b.key, h.deps), true)
  assert.equal(h.waiting.size, 0)
})

test('a switch that did not happen opens nothing and leaves no waiter behind', async () => {
  for (const outcome of ['signInAgain', null] as const) {
    const h = switching(outcome, false)

    assert.equal(await switchThenWait(b.key, h.deps), false)
    assert.equal(h.waiting.size, 0)
  }
})

test('a reload that never comes is waited for only so long', async () => {
  const h = switching('switched', false)

  assert.equal(await switchThenWait(b.key, { ...h.deps, waitMs: 10 }), true)
  assert.equal(h.waiting.size, 0)
})

test("switches run one at a time, so the second never takes the first one's reload", async () => {
  const inTurn = oneAtATime()
  const events: string[] = []
  let finishFirst!: () => void
  const first = inTurn(async () => {
    events.push('switch to B')
    await new Promise<void>((resolve) => {
      finishFirst = resolve
    })
    events.push('open B')
  })
  const second = inTurn(async () => {
    events.push('switch to C')
    throw new Error('C failed')
  })
  const third = inTurn(async () => {
    events.push('open D')
  })

  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(events, ['switch to B'])
  finishFirst()
  await first
  await assert.rejects(second)
  await third
  assert.deepEqual(events, ['switch to B', 'open B', 'switch to C', 'open D'])
})
