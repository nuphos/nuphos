import { InstaboxAuthError, InstaboxQuotaError, Sandbox } from '@insforge/instabox-sdk'
import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'

import { config } from '@/config'
import { useAgentDevicePresence } from '@/lib/test/doubles/agent-devices-presence'
import { useAgentDeviceStore } from '@/lib/test/doubles/agent-devices-store'
import { useBoxInstaboxAccount } from '@/lib/test/doubles/box-instabox-account'
import { useBoxInstaboxLimit } from '@/lib/test/doubles/box-instabox-limit'
import { useInstaboxMachines } from '@/lib/test/doubles/instabox-machines'
import { useJoinTokens } from '@/lib/test/doubles/join-tokens'

import { createBox } from './box-instabox'

import type { AgentDevice } from './store'

// A Box on the team's own instabox account, which instabox refuses to make.
const teamId = '65f000000000000000000001'
const accountId = '65f0000000000000000000a1'
const raw = 'sandbox limit reached (5 on the free plan) for owner@example.test; run `instabox ls`'
const deleted: string[] = []
const killed: string[] = []
// Spies are restored one by one: mock.restore() would also clear other files' doubles.
const spies: { mockRestore: () => void }[] = []

useBoxInstaboxAccount({
  findInstaboxAccount: () => Promise.resolve({} as never),
  boxConnection: () => Promise.resolve({ apiKey: 'k', requestTimeoutMs: 1, operationTimeoutMs: 1 }),
})
useBoxInstaboxLimit({ boxSize: () => Promise.resolve({ vcpus: 2, memMiB: 4096 }) })
useInstaboxMachines({
  listMachines: (_conn: unknown, metadata: Record<string, string>) =>
    Promise.resolve([{ sandboxId: `m_${metadata.deviceId ?? ''}` }] as never),
  killMachine: (_conn: unknown, sandboxId: string) => {
    killed.push(sandboxId)

    return Promise.resolve()
  },
})
const installStore = useAgentDeviceStore({
  insertBoxAgentDevice: (_userId: string, registration: { deviceId: string }) =>
    Promise.resolve({ deviceId: registration.deviceId } as AgentDevice),
  deleteAgentDevice: (_userId: string, deviceId: string) => {
    deleted.push(deviceId)

    return Promise.resolve(true)
  },
})

const installTokens = useJoinTokens({})
const installPresence = useAgentDevicePresence({})

const saved = config.agent.publicBackendUrl

beforeEach(() => {
  deleted.length = 0
  killed.length = 0
  config.agent.publicBackendUrl = 'https://api.example.test'
})

afterEach(() => {
  config.agent.publicBackendUrl = saved
  for (const spy of spies.splice(0)) spy.mockRestore()
})

test('an account at its limit fails the create with a plain 4xx, and leaves no Box behind', async () => {
  spies.push(
    spyOn(Sandbox, 'create').mockRejectedValue(
      new InstaboxQuotaError(raw, { status: 429, code: 'quota_exceeded', retryable: false }),
    ),
  )

  const error = await createBox('u1', teamId, 'Box', { accountId }).then(
    () => null,
    (e: unknown) => e as { status: number; code: string; message: string },
  )

  expect(error).toMatchObject({ status: 409, code: 'instabox_quota_exceeded' })
  expect(error?.message).toContain('reached its limit')
  // The provider's own text, which names the account, stays in the server log.
  expect(error?.message).not.toContain('example.test')
  expect(error?.message).not.toContain('instabox ls')
  expect(deleted).toHaveLength(1)
  expect(killed).toEqual([`m_${deleted[0] ?? ''}`])
})

test('a key the account no longer accepts fails the create with a 4xx too', async () => {
  spies.push(
    spyOn(Sandbox, 'create').mockRejectedValue(
      new InstaboxAuthError('key revoked by owner@example.test', { status: 401 }),
    ),
  )

  await expect(createBox('u1', teamId, 'Box', { accountId })).rejects.toMatchObject({
    status: 409,
    code: 'instabox_key_rejected',
  })
  expect(deleted).toHaveLength(1)
})

test('an accepted order answers at once, while the machine still boots in the background', async () => {
  // instabox accepts the POST; the machine itself never becomes ready within this test.
  spies.push(spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 202 })))
  spies.push(
    spyOn(Sandbox, 'create').mockImplementation(((
      _template: string,
      options?: { fetch?: typeof fetch },
    ) => {
      void options?.fetch?.('https://instabox.test/v1/machines', { method: 'POST' })

      return new Promise<Sandbox>(() => {})
    }) as typeof Sandbox.create),
  )

  const created = await createBox('u1', teamId, 'Box', { accountId })

  expect(created.deviceId).toBeString()
  expect(deleted).toEqual([])
})

// instabox's free plan keeps its 30-minute idle pause and refuses changing it.
const idleRefusal = () =>
  new InstaboxAuthError(
    'Free users are not able to change idle time: a free sandbox pauses after 30 idle minutes (send 1800 or leave it out)',
    { status: 403, code: 'spec_not_allowed' },
  )

test('the order leaves the idle setting out, so a plan that keeps its idle pause accepts it', async () => {
  const orders: { autoSuspendMs?: number }[] = []

  spies.push(spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 202 })))
  spies.push(
    spyOn(Sandbox, 'create').mockImplementation(((
      _template: string,
      options: { fetch?: typeof fetch; autoSuspendMs?: number },
    ) => {
      orders.push({ autoSuspendMs: options.autoSuspendMs })
      void options.fetch?.('https://instabox.test/v1/machines', { method: 'POST' })

      return new Promise<Sandbox>(() => {})
    }) as typeof Sandbox.create),
  )

  const created = await createBox('u1', teamId, 'Box', { accountId })

  expect(created.deviceId).toBeString()
  expect(orders).toEqual([{ autoSuspendMs: undefined }])
  expect(deleted).toEqual([])
})

test('a plan that refuses turning the idle pause off still gets its Box, set up to the end', async () => {
  const idle: number[] = []
  let joined = () => {}
  const waited = new Promise<void>((resolve) => {
    joined = resolve
  })
  const machine = {
    sandboxId: 'm_1',
    setAutoSuspend: (ms: number) => {
      idle.push(ms)

      return Promise.reject(idleRefusal())
    },
    commands: { run: () => Promise.resolve({}) },
  } as unknown as Sandbox

  installStore({ setAgentDeviceBoxSandbox: () => Promise.resolve(true) })
  installTokens({ issueDeviceJoinToken: () => Promise.resolve({ token: 't' } as never) })
  installPresence({
    waitForPresence: () => {
      joined()

      return Promise.resolve(true)
    },
  })
  spies.push(spyOn(Sandbox, 'create').mockResolvedValue(machine))
  spies.push(spyOn(Sandbox, 'connect').mockResolvedValue(machine))

  await createBox('u1', teamId, 'Box', { accountId })
  await waited

  expect(idle).toEqual([0])
  expect(deleted).toEqual([])
})

test('an order the plan refuses says so, instead of blaming the API key', async () => {
  spies.push(spyOn(Sandbox, 'create').mockRejectedValue(idleRefusal()))

  const error = await createBox('u1', teamId, 'Box', { accountId }).then(
    () => null,
    (e: unknown) => e as { status: number; code: string; message: string },
  )

  expect(error).toMatchObject({ status: 409, code: 'instabox_plan_not_allowed' })
  expect(error?.message).not.toContain('API key')
  expect(deleted).toHaveLength(1)
})
