import { InstaboxAuthError, InstaboxQuotaError, Sandbox } from '@insforge/instabox-sdk'
import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test'

import { config } from '@/config'
import { useAgentDeviceStore } from '@/lib/test/doubles/agent-devices-store'
import { useBoxInstaboxAccount } from '@/lib/test/doubles/box-instabox-account'
import { useBoxInstaboxLimit } from '@/lib/test/doubles/box-instabox-limit'
import { useInstaboxMachines } from '@/lib/test/doubles/instabox-machines'

import { createBox } from './box-instabox'

import type { AgentDevice } from './store'

// A Box on the team's own instabox account, which instabox refuses to make.
const teamId = '65f000000000000000000001'
const accountId = '65f0000000000000000000a1'
const raw = 'sandbox limit reached (5 on the free plan) for owner@example.test; run `instabox ls`'
const deleted: string[] = []
const killed: string[] = []

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
useAgentDeviceStore({
  insertBoxAgentDevice: (_userId: string, registration: { deviceId: string }) =>
    Promise.resolve({ deviceId: registration.deviceId } as AgentDevice),
  deleteAgentDevice: (_userId: string, deviceId: string) => {
    deleted.push(deviceId)

    return Promise.resolve(true)
  },
})

const saved = config.agent.publicBackendUrl

beforeEach(() => {
  deleted.length = 0
  killed.length = 0
  config.agent.publicBackendUrl = 'https://api.example.test'
})

afterEach(() => {
  config.agent.publicBackendUrl = saved
  mock.restore()
})

test('an account at its limit fails the create with a plain 4xx, and leaves no Box behind', async () => {
  spyOn(Sandbox, 'create').mockRejectedValue(
    new InstaboxQuotaError(raw, { status: 429, code: 'quota_exceeded', retryable: false }),
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
  spyOn(Sandbox, 'create').mockRejectedValue(
    new InstaboxAuthError('key revoked by owner@example.test', { status: 401 }),
  )

  await expect(createBox('u1', teamId, 'Box', { accountId })).rejects.toMatchObject({
    status: 409,
    code: 'instabox_key_rejected',
  })
  expect(deleted).toHaveLength(1)
})

test('an accepted order answers at once, while the machine still boots in the background', async () => {
  // instabox accepts the POST; the machine itself never becomes ready within this test.
  spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 202 }))
  spyOn(Sandbox, 'create').mockImplementation(((
    _template: string,
    options?: { fetch?: typeof fetch },
  ) => {
    void options?.fetch?.('https://instabox.test/v1/machines', { method: 'POST' })

    return new Promise<Sandbox>(() => {})
  }) as typeof Sandbox.create)

  const created = await createBox('u1', teamId, 'Box', { accountId })

  expect(created.deviceId).toBeString()
  expect(deleted).toEqual([])
})
