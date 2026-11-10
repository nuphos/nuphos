import { expect, spyOn, test } from 'bun:test'

import { settlePendingRemovals } from './pending-removals'

import type { PendingRemoval } from './agent-registry'
import type { PendingRemovalDeps } from './pending-removals'
import type { LocalRuntimeStatus } from './local-runtime/protocol'

const removal = (id: string, agent: PendingRemoval['agent']): PendingRemoval => ({
  id,
  agent,
  actorId: 'manager',
  teamId: 'team',
  at: new Date(0),
})
const online: LocalRuntimeStatus = { agents: {}, agentInstances: true }
const target = { userId: 'owner', actorId: 'manager', deviceId: 'box', teamId: 'team' }

function deps(
  pending: PendingRemoval[] | Error,
  fail: string[] = [],
  members = ['manager', 'owner'],
  owner = 'owner',
) {
  const calls: unknown[] = []
  const retries: number[] = []
  const forgotten = new Set<string>()
  const injected: PendingRemovalDeps = {
    pending: async () => {
      if (pending instanceof Error) throw pending

      // As the store: a removal the computer carried out is gone.
      return { removals: pending.filter((entry) => !forgotten.has(entry.id)), owner }
    },
    remove: async (to, agent) => {
      calls.push({ removed: [to, agent] })
      if ('instanceId' in agent && fail.includes(agent.instanceId)) throw new Error('timed out')
    },
    forgetAgent: async (_userId, _deviceId, agent) => {
      calls.push({ unregistered: agent })
    },
    forget: async (_userId, _deviceId, removalId) => {
      forgotten.add(removalId)
      calls.push({ forgot: removalId })
    },
    isMember: async (userId) => members.includes(userId),
    later: (_retry, ms) => {
      retries.push(ms)
    },
  }

  return { injected, calls, retries }
}

const quiet = () => spyOn(console, 'warn').mockImplementation(() => {})

test('a computer back online deletes each pending agent as its remover, then forgets it', async () => {
  const { injected, calls, retries } = deps([
    removal('r1', { instanceId: 'agent-1' }),
    removal('r2', { provider: 'codex' }),
  ])

  await settlePendingRemovals('owner', 'box', online, injected)

  expect(calls).toEqual([
    { removed: [target, { instanceId: 'agent-1' }] },
    // A report that registered it before the removal was marked is undone too.
    { unregistered: { instanceId: 'agent-1' } },
    { forgot: 'r1' },
    { removed: [target, { provider: 'codex' }] },
    { unregistered: { provider: 'codex' } },
    { forgot: 'r2' },
  ])
  expect(retries).toEqual([])
})

test('a removal the computer cannot carry out stays pending and is retried', async () => {
  const warn = quiet()
  const { injected, calls, retries } = deps(
    [removal('r1', { instanceId: 'agent-1' }), removal('r2', { instanceId: 'agent-2' })],
    ['agent-1'],
  )

  await settlePendingRemovals('owner', 'box', online, injected)
  warn.mockRestore()

  expect(calls.filter((call) => 'forgot' in (call as object))).toEqual([{ forgot: 'r2' }])
  expect(retries).toEqual([60_000])
})

test('a failed read never escapes as a rejection, and is retried', async () => {
  const warn = quiet()
  const { injected, retries } = deps(new Error('mongo down'))

  await expect(settlePendingRemovals('owner', 'box', online, injected)).resolves.toBeUndefined()
  warn.mockRestore()
  expect(retries).toEqual([60_000])
})

test('retries stop after a few attempts; the next report starts again', async () => {
  const warn = quiet()
  const { injected, retries } = deps(new Error('mongo down'))

  await settlePendingRemovals('owner', 'box', online, injected, 5)
  warn.mockRestore()
  expect(retries).toEqual([])
})

test('two reports from one computer never settle the same removals at once', async () => {
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const { injected, calls } = deps([removal('r1', { instanceId: 'agent-1' })])
  const slow: PendingRemovalDeps = {
    ...injected,
    pending: async (...args) => {
      await gate

      return injected.pending(...args)
    },
  }

  const first = settlePendingRemovals('owner', 'box', online, slow)

  await settlePendingRemovals('owner', 'box', online, slow)
  release()
  await first

  expect(calls.filter((call) => 'removed' in (call as object))).toHaveLength(1)
})

test('a host that cannot remove agents is left alone', async () => {
  const { injected, calls } = deps([removal('r1', { instanceId: 'agent-1' })])

  await settlePendingRemovals('owner', 'box', { agents: {} }, injected)

  expect(calls).toEqual([])
})

test('a remover who left the team is replaced by the computer owner', async () => {
  const { injected, calls } = deps([removal('r1', { instanceId: 'agent-1' })], [], ['owner'])

  await settlePendingRemovals('owner', 'box', online, injected)

  expect(calls[0]).toEqual({
    removed: [{ ...target, actorId: 'owner' }, { instanceId: 'agent-1' }],
  })
})

test('a Box passed to a new owner falls back to that owner, not its transport user', async () => {
  const { injected, calls } = deps(
    [removal('r1', { instanceId: 'agent-1' })],
    [],
    ['new-owner'],
    'new-owner',
  )

  await settlePendingRemovals('owner', 'box', online, injected)

  expect(calls[0]).toEqual({
    removed: [{ ...target, actorId: 'new-owner' }, { instanceId: 'agent-1' }],
  })
})

test('with no one left in the team to remove it, the agent stops being hidden', async () => {
  const warn = quiet()
  const { injected, calls, retries } = deps([removal('r1', { instanceId: 'agent-1' })], [], [])

  await settlePendingRemovals('owner', 'box', online, injected)
  warn.mockRestore()

  expect(calls).toEqual([{ forgot: 'r1' }])
  expect(retries).toEqual([])
})

test('a settle asked for while one runs runs again after it', async () => {
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let reads = 0
  const { injected } = deps([])
  const slow: PendingRemovalDeps = {
    ...injected,
    pending: async () => {
      reads++
      if (reads === 1) await gate

      return { removals: [], owner: 'owner' }
    },
  }
  const first = settlePendingRemovals('owner', 'box2', online, slow)

  await settlePendingRemovals('owner', 'box2', online, slow)
  release()
  await first

  expect(reads).toBe(2)
})
