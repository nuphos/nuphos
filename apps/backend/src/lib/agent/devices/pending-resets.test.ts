import { expect, spyOn, test } from 'bun:test'

import { AppError } from '@/lib/errors'

import { requestAgentReset, settlePendingResets } from './pending-resets'

import type { PendingRemoval, PendingReset } from './agent-registry'
import type { LocalRuntimeStatus, RemovableAgent } from './local-runtime/protocol'
import type { PendingResetDeps } from './pending-resets'

const entry = (id: string, agent: RemovableAgent): PendingReset => ({
  id,
  agent,
  actorId: 'manager',
  teamId: 'team',
  at: new Date(0),
})
const online: LocalRuntimeStatus = { agents: {}, agentInstances: true, agentReset: true }
const target = { userId: 'owner', actorId: 'manager', deviceId: 'box', teamId: 'team' }
const by = { actorId: 'manager', teamId: 'team' }
const device = { userId: 'owner', deviceId: 'box' }
const offline = new AppError(409, 'runtime_offline', 'The Box disconnected before answering.')
const notFound = new AppError(409, 'agent_instance_failed', 'Runtime instance not found')

function deps({
  status,
  pending = [],
  removals = [],
  fail = {},
  members = ['manager', 'owner'],
}: {
  status?: LocalRuntimeStatus
  pending?: PendingReset[] | Error
  removals?: PendingRemoval[]
  fail?: Record<string, Error>
  members?: string[]
} = {}) {
  const calls: unknown[] = []
  const retries: number[] = []
  const stored = pending instanceof Error ? [] : [...pending]
  const injected: PendingResetDeps = {
    pending: async () => {
      if (pending instanceof Error) throw pending

      return { resets: [...stored], removals, owner: 'owner' }
    },
    presence: async () => (status ? { status } : null) as never,
    reset: async (to, agent) => {
      calls.push({ reset: [to, agent] })
      const error = fail['instanceId' in agent ? agent.instanceId : agent.provider]

      if (error) throw error
    },
    // As the store: one already pending for the agent stands.
    record: async (_userId, _deviceId, reset) => {
      calls.push({ recorded: reset.agent })
      if (!stored.some((had) => JSON.stringify(had.agent) === JSON.stringify(reset.agent)))
        stored.push(reset)
    },
    forget: async (_userId, _deviceId, id) => {
      calls.push({ forgot: id })
      stored.splice(
        stored.findIndex((had) => had.id === id),
        1,
      )
    },
    // As the store: the agent's resets asked for before `before` go.
    retire: async (_userId, _deviceId, agent, before) => {
      calls.push({ retired: agent })
      for (const had of [...stored])
        if (JSON.stringify(had.agent) === JSON.stringify(agent) && had.at < before)
          stored.splice(stored.indexOf(had), 1)
    },
    isMember: async (userId) => members.includes(userId),
    later: (_retry, ms) => {
      retries.push(ms)
    },
  }

  return { injected, calls, retries, stored }
}

const quiet = () => spyOn(console, 'warn').mockImplementation(() => {})

test('a connected host that can reset signs the agent out at once', async () => {
  const { injected, calls, stored } = deps({ status: online })

  expect(await requestAgentReset(device, { instanceId: 'a1' }, by, injected)).toEqual({
    state: 'done',
  })
  expect(calls).toEqual([
    { reset: [target, { instanceId: 'a1' }] },
    { retired: { instanceId: 'a1' } },
  ])
  expect(stored).toEqual([])
})

test('a reset run at once retires one queued for the agent before it, not another agent’s', async () => {
  const { injected, stored } = deps({
    status: online,
    pending: [entry('r1', { instanceId: 'a1' }), entry('r2', { instanceId: 'a2' })],
  })

  expect(await requestAgentReset(device, { instanceId: 'a1' }, by, injected)).toEqual({
    state: 'done',
  })
  // Else a replay would sign out whatever was signed in after this reset.
  expect(stored.map((reset) => reset.id)).toEqual(['r2'])
})

test('an offline computer gets the reset queued', async () => {
  const { injected, calls, stored } = deps()

  expect(await requestAgentReset(device, { provider: 'codex' }, by, injected)).toEqual({
    state: 'queued',
    why: 'offline',
  })
  expect(calls).toEqual([{ recorded: { provider: 'codex' } }])
  expect(stored[0]).toMatchObject({ agent: { provider: 'codex' }, ...by })
})

test('a host that drops or never answers gets the reset queued', async () => {
  const warn = quiet()

  for (const error of [
    offline,
    new AppError(504, 'agent_instance_timeout', 'The Box did not answer in time.'),
  ]) {
    const { injected, calls, stored, retries } = deps({ status: online, fail: { a1: error } })
    // A computer of its own, as it is still connected and so settled at once in the background.
    const elsewhere = { userId: 'owner', deviceId: error.code }

    expect(await requestAgentReset(elsewhere, { instanceId: 'a1' }, by, injected)).toEqual({
      state: 'queued',
      why: 'offline',
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(stored).toHaveLength(1)
    expect(calls.filter((call) => 'reset' in (call as object))).toHaveLength(2)
    expect(retries).toEqual([60_000])
  }
  warn.mockRestore()
})

test('a host that answers with a refusal throws and queues nothing', async () => {
  const refused = new AppError(409, 'agent_instance_failed', 'Antigravity cannot be reset')
  const { injected, stored } = deps({ status: online, fail: { antigravity: refused } })

  await expect(requestAgentReset(device, { provider: 'antigravity' }, by, injected)).rejects.toBe(
    refused,
  )
  expect(stored).toEqual([])
})

test('a host too old to reset queues it, and runs it once it reports in updated', async () => {
  const { injected, calls, stored } = deps({ status: { agents: {}, agentInstances: true } })

  expect(await requestAgentReset(device, { instanceId: 'a1' }, by, injected)).toEqual({
    state: 'queued',
    why: 'unsupported',
  })
  expect(calls).toEqual([{ recorded: { instanceId: 'a1' } }])
  const id = stored[0]?.id

  await settlePendingResets('owner', 'box', online, injected)
  expect(calls.slice(1)).toEqual([{ reset: [target, { instanceId: 'a1' }] }, { forgot: id }])
  expect(stored).toEqual([])
})

test('a second reset of an agent already pending adds nothing', async () => {
  const { injected, stored } = deps()

  await requestAgentReset(device, { instanceId: 'a1' }, by, injected)
  await requestAgentReset(device, { instanceId: 'a1' }, by, injected)
  expect(stored).toHaveLength(1)
})

test('a computer back online runs each pending reset as its requester, then forgets it', async () => {
  const { injected, calls, retries } = deps({
    pending: [entry('r1', { instanceId: 'a1' }), entry('r2', { provider: 'codex' })],
  })

  await settlePendingResets('owner', 'box', online, injected)

  expect(calls).toEqual([
    { reset: [target, { instanceId: 'a1' }] },
    { forgot: 'r1' },
    { reset: [target, { provider: 'codex' }] },
    { forgot: 'r2' },
  ])
  expect(retries).toEqual([])
})

test('an agent the computer no longer has, or one being removed, drops its reset', async () => {
  const { injected, calls, retries } = deps({
    pending: [entry('r1', { instanceId: 'gone' }), entry('r2', { instanceId: 'removed' })],
    removals: [{ ...entry('x', { instanceId: 'removed' }) }],
    fail: { gone: notFound },
  })

  await settlePendingResets('owner', 'box', online, injected)

  expect(calls).toEqual([
    { reset: [target, { instanceId: 'gone' }] },
    { forgot: 'r1' },
    { forgot: 'r2' },
  ])
  expect(retries).toEqual([])
})

test('a requester who left the team is replaced by the owner, and with neither it is dropped', async () => {
  const warn = quiet()
  const left = deps({ pending: [entry('r1', { instanceId: 'a1' })], members: ['owner'] })
  const none = deps({ pending: [entry('r1', { instanceId: 'a1' })], members: [] })

  await settlePendingResets('owner', 'box', online, left.injected)
  await settlePendingResets('owner', 'box', online, none.injected)
  warn.mockRestore()

  expect(left.calls[0]).toEqual({ reset: [{ ...target, actorId: 'owner' }, { instanceId: 'a1' }] })
  expect(none.calls).toEqual([{ forgot: 'r1' }])
})

test('a reset that fails stays pending and is retried, a few times only', async () => {
  const warn = quiet()
  const { injected, stored, retries } = deps({
    pending: [entry('r1', { instanceId: 'a1' })],
    fail: { a1: offline },
  })

  await settlePendingResets('owner', 'box', online, injected)
  await settlePendingResets('owner', 'box', online, injected, 5)
  await expect(
    settlePendingResets('owner', 'box', online, deps({ pending: new Error('down') }).injected),
  ).resolves.toBeUndefined()
  warn.mockRestore()

  expect(stored).toHaveLength(1)
  expect(retries).toEqual([60_000])
})

test('a host that cannot reset is left alone', async () => {
  const { injected, calls } = deps({ pending: [entry('r1', { instanceId: 'a1' })] })

  await settlePendingResets('owner', 'box', { agents: {}, agentInstances: true }, injected)

  expect(calls).toEqual([])
})

test('two reports from one computer never settle the same resets at once', async () => {
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const { injected, calls } = deps({ pending: [entry('r1', { instanceId: 'a1' })] })
  const slow: PendingResetDeps = {
    ...injected,
    pending: async (...args) => {
      await gate

      return injected.pending(...args)
    },
  }
  const first = settlePendingResets('owner', 'box', online, slow)

  await settlePendingResets('owner', 'box', online, slow)
  release()
  await first

  expect(calls.filter((call) => 'reset' in (call as object))).toHaveLength(1)
})

test('a report during a failed pass waits for its retry, not a pass at once', async () => {
  const warn = quiet()
  const { injected, calls, retries } = deps({
    pending: [entry('r1', { instanceId: 'a1' })],
    fail: { a1: offline },
  })
  // Stopping the agent sends a report, which lands while this pass runs.
  const reporting: PendingResetDeps = {
    ...injected,
    reset: async (...args) => {
      await settlePendingResets('owner', 'box', online, reporting)

      return injected.reset(...args)
    },
  }

  await settlePendingResets('owner', 'box', online, reporting)
  warn.mockRestore()

  expect(calls.filter((call) => 'reset' in (call as object))).toHaveLength(1)
  expect(retries).toEqual([60_000])
})

test('a reset retired while its pass reads it is not run over the sign-in that retired it', async () => {
  const { injected, calls, stored } = deps({ pending: [entry('r1', { instanceId: 'a1' })] })
  let reads = 0
  const signingIn: PendingResetDeps = {
    ...injected,
    pending: async (...args) => {
      // A new sign-in lands after the pass loaded its resets, retiring this one.
      if (++reads === 2) stored.splice(0)

      return injected.pending(...args)
    },
  }

  await settlePendingResets('owner', 'box', online, signingIn)

  expect(calls.filter((call) => 'reset' in (call as object))).toEqual([])
})
