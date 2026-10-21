import { Sandbox } from '@insforge/instabox-sdk'
import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'

import { config } from '@/config'
import { AppError } from '@/lib/errors'
import { useAgentDevicePresence } from '@/lib/test/doubles/agent-devices-presence'
import { useAgentDeviceStore } from '@/lib/test/doubles/agent-devices-store'
import { useBoxInstaboxLimit } from '@/lib/test/doubles/box-instabox-limit'

import { pauseBox, resumeBox, wakeBox } from './box-instabox'

import type { AgentDevice } from './store'

// A paused Box whose team is already at its vCPU limit: the limit check refuses the start.
const teamId = '65f000000000000000000001'
const paused = {
  deviceId: 'd1',
  box: { provider: 'instabox', teamId, sandboxId: 'm_paused', createdBy: 'u1' },
} as unknown as AgentDevice
const checked: [string, unknown][] = []

const installStore = useAgentDeviceStore({ getAgentDevice: () => Promise.resolve(paused) })

useAgentDevicePresence({ isDevicePresent: () => Promise.resolve(false) })
useBoxInstaboxLimit({
  startWithinLimit: (team: string, starting: unknown) => {
    checked.push([team, starting])

    return Promise.reject(new AppError(402, 'box_vcpu_limit', 'Over the limit'))
  },
})

const saved = config.agent.publicBackendUrl

beforeEach(() => {
  checked.length = 0
  config.agent.publicBackendUrl = 'https://api.example.test'
})

// Config is shared by every test file in this process: put it back after each case.
afterEach(() => {
  config.agent.publicBackendUrl = saved
})

test('resuming a paused Box goes through the team limit, and a refusal is a 402', async () => {
  await expect(resumeBox('u1', 'd1')).rejects.toMatchObject({
    status: 402,
    code: 'box_vcpu_limit',
  })
  expect(checked).toEqual([[teamId, { sandboxId: 'm_paused' }]])
})

test('waking a paused Box goes through the same limit', async () => {
  await expect(wakeBox('u1', 'd1')).rejects.toMatchObject({ status: 402 })
  expect(checked).toEqual([[teamId, { sandboxId: 'm_paused' }]])
})

test('a plain resume is refused while an update restarts the host', async () => {
  const updating = {
    ...paused,
    box: { ...paused.box, updateStartedAt: new Date() },
  } as AgentDevice

  installStore({ getAgentDevice: () => Promise.resolve(updating) })
  await expect(resumeBox('u1', 'd1')).rejects.toMatchObject({ status: 409, code: 'box_updating' })
  expect(checked).toEqual([])
})

test('pausing an updating Box ends its update, so a resume starts the host again', async () => {
  const writes: unknown[] = []
  const savedBox = config.box.instabox
  const connect = spyOn(Sandbox, 'connect').mockResolvedValue({
    pause: () => Promise.resolve(),
  } as unknown as Sandbox)

  config.box.instabox = { apiKey: 'test' }
  installStore({
    getAgentDevice: () =>
      Promise.resolve({ ...paused, box: { ...paused.box, updateStartedAt: new Date() } }),
    agentDevices: () =>
      ({
        updateOne: (filter: unknown, update: unknown) => {
          writes.push([filter, update])

          return Promise.resolve({ matchedCount: 1 })
        },
      }) as never,
  })
  try {
    await pauseBox('u1', 'd1')
  } finally {
    connect.mockRestore()
    config.box.instabox = savedBox
  }
  expect(writes).toEqual([
    [
      { userId: 'u1', deviceId: 'd1', box: { $exists: true } },
      { $unset: { 'box.updateStartedAt': '' } },
    ],
  ])
})

test('a pause that happened is not reported as failed when ending the update note fails', async () => {
  const savedBox = config.box.instabox
  const restore = () => {
    connect.mockRestore()
    config.box.instabox = savedBox
  }
  const connect = spyOn(Sandbox, 'connect').mockResolvedValue({
    pause: () => Promise.resolve(),
  } as unknown as Sandbox)
  const failingWrite = { updateOne: () => Promise.reject(new Error('mongo is down')) }

  config.box.instabox = { apiKey: 'test' }
  installStore({
    getAgentDevice: () =>
      Promise.resolve({ ...paused, box: { ...paused.box, updateStartedAt: new Date() } }),
    agentDevices: () => failingWrite,
  })
  await expect(pauseBox('u1', 'd1').finally(restore)).resolves.toMatchObject({ deviceId: 'd1' })
})
