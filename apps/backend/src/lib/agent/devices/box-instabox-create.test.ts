import {
  InstaboxAuthError,
  InstaboxError,
  InstaboxQuotaError,
  InstaboxTimeoutError,
  Sandbox,
} from '@insforge/instabox-sdk'
import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'

import { config } from '@/config'
import { useAgentDevicePresence } from '@/lib/test/doubles/agent-devices-presence'
import { useAgentDeviceStore } from '@/lib/test/doubles/agent-devices-store'
import { useBoxInstaboxAccount } from '@/lib/test/doubles/box-instabox-account'
import { useBoxInstaboxLimit } from '@/lib/test/doubles/box-instabox-limit'
import { useInstaboxMachines } from '@/lib/test/doubles/instabox-machines'
import { useJoinTokens } from '@/lib/test/doubles/join-tokens'

import { createBox } from './box-instabox'
import { BOX_INSTALL_COMMAND } from './box-instabox-client'

import type { AgentDevice } from './store'

// A Box on the team's own instabox account, which instabox refuses to make.
const teamId = '65f000000000000000000001'
const accountId = '65f0000000000000000000a1'
const raw = 'sandbox limit reached (5 on the free plan) for owner@example.test; run `instabox ls`'
const deleted: string[] = []
const killed: string[] = []
// The time each instabox connection was given.
const budgets: number[] = []
// Spies are restored one by one: mock.restore() would also clear other files' doubles.
const spies: { mockRestore: () => void }[] = []

useBoxInstaboxAccount({
  findInstaboxAccount: () => Promise.resolve({} as never),
  boxConnection: (_account: unknown, budget: number) => {
    budgets.push(budget)

    return Promise.resolve({ apiKey: 'k', requestTimeoutMs: 1, operationTimeoutMs: 1 })
  },
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

test('an order waits out an instabox that queues it for minutes (#4146)', async () => {
  budgets.length = 0
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

  await createBox('u1', teamId, 'Box', { accountId })
  // instabox has held a create in its queue for over 4 minutes before starting it.
  expect(budgets[0]).toBeGreaterThanOrEqual(10 * 60_000)
})

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

/** Sets a Box up to the end, its install failing first with `failure`; the commands it ran. */
async function setUpWithInstallFailing(failure: Error) {
  const ran: string[] = []
  let settled = () => {}
  const done = new Promise<void>((resolve) => {
    settled = resolve
  })
  const machine = {
    sandboxId: 'm_1',
    setAutoSuspend: () => Promise.resolve(),
    commands: {
      run: (command: string) => {
        ran.push(command)

        return command === BOX_INSTALL_COMMAND && ran.length === 1
          ? Promise.reject(failure)
          : Promise.resolve({})
      },
    },
  } as unknown as Sandbox

  installStore({
    setAgentDeviceBoxSandbox: () => Promise.resolve(true),
    deleteAgentDevice: (_userId: string, deviceId: string) => {
      deleted.push(deviceId)
      settled()

      return Promise.resolve(true)
    },
  })
  installTokens({
    issueDeviceJoinToken: () => Promise.resolve({ token: 't' } as never),
    deleteDeviceJoinTokens: () => Promise.resolve(),
  })
  installPresence({
    waitForPresence: () => {
      settled()

      return Promise.resolve(true)
    },
  })
  spies.push(spyOn(Sandbox, 'create').mockResolvedValue(machine))
  spies.push(spyOn(Sandbox, 'connect').mockResolvedValue(machine))

  await createBox('u1', teamId, 'Box', { accountId })
  await done

  return ran.filter((command) => command === BOX_INSTALL_COMMAND).length
}

test('a connection reset mid-install runs the install again on the same machine', async () => {
  const reset = new InstaboxError('POST /v1/machines/m_1/exec failed: socket closed', {
    code: 'network_error',
    retryable: true,
  })

  expect(await setUpWithInstallFailing(reset)).toBe(2)
  expect(deleted).toEqual([])
  expect(killed).toEqual([])
})

test('an install that timed out is not run again: the Box is discarded', async () => {
  const timedOut = new InstaboxTimeoutError('POST /v1/machines/m_1/exec timed out', {
    code: 'request_timeout',
  })

  expect(await setUpWithInstallFailing(timedOut)).toBe(1)
  expect(deleted).toHaveLength(1)
})

test('a host that joined stays, though instabox answered the exec that started it too late (#4620)', async () => {
  let settled = () => {}
  const done = new Promise<void>((resolve) => {
    settled = resolve
  })
  const machine = {
    sandboxId: 'm_1',
    setAutoSuspend: () => Promise.resolve(),
    commands: {
      run: (_command: string, options?: { background?: boolean }) =>
        options?.background
          ? Promise.reject(
              new InstaboxTimeoutError('POST /v1/machines/m_1/exec timed out after 15000 ms', {
                code: 'request_timeout',
              }),
            )
          : Promise.resolve({}),
    },
  } as unknown as Sandbox

  installStore({
    setAgentDeviceBoxSandbox: () => Promise.resolve(true),
    deleteAgentDevice: (_userId: string, deviceId: string) => {
      deleted.push(deviceId)
      settled()

      return Promise.resolve(true)
    },
  })
  installTokens({
    issueDeviceJoinToken: () => Promise.resolve({ token: 't' } as never),
    deleteDeviceJoinTokens: () => Promise.resolve(),
  })
  installPresence({
    waitForPresence: () => {
      setTimeout(settled, 10)

      return Promise.resolve(true)
    },
  })
  spies.push(spyOn(Sandbox, 'create').mockResolvedValue(machine))
  spies.push(spyOn(Sandbox, 'connect').mockResolvedValue(machine))

  await createBox('u1', teamId, 'Box', { accountId })
  await done

  expect(deleted).toEqual([])
  expect(killed).toEqual([])
})

test('a gifted OpenRouter key is recorded on the Box, written to its OpenCode, and revoked when the Box is discarded', async () => {
  const savedFetch = globalThis.fetch
  const openRouter: string[] = []
  const recorded: string[] = []
  const configs: string[] = []
  let settled = () => {}
  const done = new Promise<void>((resolve) => {
    settled = resolve
  })
  const machine = {
    sandboxId: 'm_1',
    setAutoSuspend: () => Promise.resolve(),
    commands: {
      run: (_command: string, options?: { envs?: Record<string, string> }) => {
        if (options?.envs?.OPENCODE_CONFIG) configs.push(options.envs.OPENCODE_CONFIG)

        return Promise.resolve({})
      },
    },
  } as unknown as Sandbox

  config.box.openRouterManagementKey = 'mgmt'
  globalThis.fetch = Object.assign(
    (input: string | URL | Request, init?: RequestInit) => {
      openRouter.push(
        `${String(init?.method)} ${input instanceof Request ? input.url : input.toString()}`,
      )

      return Promise.resolve(Response.json({ data: { hash: 'h1' }, key: 'sk-or-v1-gift' }))
    },
    { preconnect: savedFetch.preconnect },
  )
  installStore({
    setAgentDeviceBoxSandbox: () => Promise.resolve(true),
    deleteAgentDevice: (_userId: string, deviceId: string) => {
      deleted.push(deviceId)
      settled()

      return Promise.resolve(true)
    },
    agentDevices: () =>
      ({
        updateOne: (_filter: unknown, update: { $set: Record<string, string> }) => {
          recorded.push(update.$set['box.openRouterKeyHash'] ?? '')

          return Promise.resolve({ matchedCount: 1 })
        },
      }) as never,
  })
  installTokens({
    issueDeviceJoinToken: () => Promise.resolve({ token: 't' } as never),
    deleteDeviceJoinTokens: () => Promise.resolve(),
  })
  // The host never joins, so the Box is discarded.
  installPresence({ waitForPresence: () => Promise.resolve(false) })
  spies.push(spyOn(Sandbox, 'create').mockResolvedValue(machine))
  spies.push(spyOn(Sandbox, 'connect').mockResolvedValue(machine))

  try {
    await createBox('u1', teamId, 'Box', { accountId, openRouterGift: true })
    await done
  } finally {
    globalThis.fetch = savedFetch
    delete config.box.openRouterManagementKey
  }

  expect(recorded).toEqual(['h1'])
  expect(JSON.parse(configs[0] ?? '{}')).toMatchObject({
    provider: { openrouter: { options: { apiKey: 'sk-or-v1-gift' } } },
  })
  expect(openRouter).toEqual([
    'POST https://openrouter.ai/api/v1/keys',
    'DELETE https://openrouter.ai/api/v1/keys/h1',
  ])
  expect(deleted).toHaveLength(1)
})

test('the OpenRouter config is written though instabox answers its exec after the request cap (#5329)', async () => {
  const savedFetch = globalThis.fetch
  const configs: string[] = []
  let settled = () => {}
  const done = new Promise<void>((resolve) => {
    settled = resolve
  })

  // instabox, and OpenRouter: an exec is answered after 50 ms, past the 15 ms cap of the
  // connection the machine was ordered on, but well within the command's own budget.
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())

      if (url.hostname === 'openrouter.ai')
        return Response.json({ data: { hash: 'h1' }, key: 'sk-or-v1-gift' })
      if (init?.method === 'GET') return Response.json({ id: 'm_1', state: 'running' })
      if (!url.pathname.endsWith('/exec')) return new Response('{}', { status: 404 })
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 50)

        init?.signal?.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(new Error('aborted'))
        })
      })
      const { envs } = JSON.parse(init?.body as string) as { envs?: Record<string, string> }

      if (envs?.OPENCODE_CONFIG) configs.push(envs.OPENCODE_CONFIG)

      return Response.json({ stdout: '', stderr: '', exitCode: 0 })
    },
    { preconnect: savedFetch.preconnect },
  )
  const machine = await Sandbox.connect('m_1', {
    apiKey: 'k',
    requestTimeoutMs: 15,
    resume: false,
  })

  config.box.openRouterManagementKey = 'mgmt'
  installStore({
    setAgentDeviceBoxSandbox: () => Promise.resolve(true),
    agentDevices: () => ({ updateOne: () => Promise.resolve({ matchedCount: 1 }) }) as never,
  })
  installTokens({ issueDeviceJoinToken: () => Promise.resolve({ token: 't' } as never) })
  installPresence({
    waitForPresence: () => {
      settled()

      return Promise.resolve(true)
    },
  })
  spies.push(spyOn(Sandbox, 'create').mockResolvedValue(machine))

  try {
    await createBox('u1', teamId, 'Box', { accountId, openRouterGift: true })
    await done
  } finally {
    globalThis.fetch = savedFetch
    delete config.box.openRouterManagementKey
  }

  expect(JSON.parse(configs[0] ?? '{}')).toMatchObject({
    provider: { openrouter: { options: { apiKey: 'sk-or-v1-gift' } } },
  })
  expect(deleted).toEqual([])
})
