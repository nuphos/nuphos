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

function deps(pending: PendingRemoval[], fail: string[] = []) {
  const calls: unknown[] = []
  const injected: PendingRemovalDeps = {
    pending: async () => pending,
    remove: async (target, agent) => {
      calls.push({ removed: [target, agent] })
      if ('instanceId' in agent && fail.includes(agent.instanceId)) throw new Error('timed out')
    },
    forget: async (_userId, _deviceId, id) => {
      calls.push({ forgot: id })
    },
  }

  return { injected, calls }
}

test('a computer back online deletes each pending agent as its remover, then forgets it', async () => {
  const { injected, calls } = deps([
    removal('r1', { instanceId: 'agent-1' }),
    removal('r2', { provider: 'codex' }),
  ])

  await settlePendingRemovals('owner', 'box', online, injected)

  const target = { userId: 'owner', actorId: 'manager', deviceId: 'box', teamId: 'team' }

  expect(calls).toEqual([
    { removed: [target, { instanceId: 'agent-1' }] },
    { forgot: 'r1' },
    { removed: [target, { provider: 'codex' }] },
    { forgot: 'r2' },
  ])
})

test('a removal the computer cannot carry out stays pending for its next report', async () => {
  const warn = spyOn(console, 'warn').mockImplementation(() => {})
  const { injected, calls } = deps(
    [removal('r1', { instanceId: 'agent-1' }), removal('r2', { instanceId: 'agent-2' })],
    ['agent-1'],
  )

  await settlePendingRemovals('owner', 'box', online, injected)
  warn.mockRestore()

  expect(calls.filter((call) => 'forgot' in (call as object))).toEqual([{ forgot: 'r2' }])
})

test('a host that cannot remove agents is left alone', async () => {
  const { injected, calls } = deps([removal('r1', { instanceId: 'agent-1' })])

  await settlePendingRemovals('owner', 'box', { agents: {} }, injected)

  expect(calls).toEqual([])
})
