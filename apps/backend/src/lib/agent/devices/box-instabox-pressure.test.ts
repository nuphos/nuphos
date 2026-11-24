import { InstaboxTimeoutError, Sandbox } from '@insforge/instabox-sdk'
import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'

import { config } from '@/config'
import { useAgentDevicePresence } from '@/lib/test/doubles/agent-devices-presence'
import { useAgentDeviceStore } from '@/lib/test/doubles/agent-devices-store'
import { useBoxInstaboxLimit } from '@/lib/test/doubles/box-instabox-limit'
import { useInstaboxMachines } from '@/lib/test/doubles/instabox-machines'

import { resumeBox } from './box-instabox'

import type { AgentDevice } from './store'

// A running Box whose host stopped answering: the command that starts it again times out.
const box = {
  userId: 'u1',
  deviceId: 'd1',
  box: { provider: 'instabox', teamId: '65f000000000000000000001', sandboxId: 'm_full' },
} as unknown as AgentDevice
let pressure: { cpu: boolean; memory: boolean } | undefined | Error
const writes: unknown[] = []

useAgentDevicePresence({ isDevicePresent: () => Promise.resolve(false) })
useBoxInstaboxLimit({ startWithinLimit: (_team, _starting, start) => start() })
useAgentDeviceStore({
  getAgentDevice: () => Promise.resolve(box),
  agentDevices: () => ({
    updateOne: (filter: unknown, update: unknown) => {
      writes.push([filter, update])

      return Promise.resolve({ matchedCount: 1 })
    },
  }),
})
useInstaboxMachines({
  machinePressure: () =>
    pressure instanceof Error ? Promise.reject(pressure) : Promise.resolve(pressure),
})

const saved = { url: config.agent.publicBackendUrl, instabox: config.box.instabox }
let connect: ReturnType<typeof spyOn>

beforeEach(() => {
  writes.length = 0
  config.agent.publicBackendUrl = 'https://api.example.test'
  config.box.instabox = { apiKey: 'test' }
  connect = spyOn(Sandbox, 'connect').mockResolvedValue({
    commands: { run: () => Promise.reject(new InstaboxTimeoutError('timed out after 15000 ms')) },
  } as unknown as Sandbox)
})

afterEach(() => {
  connect.mockRestore()
  config.agent.publicBackendUrl = saved.url
  config.box.instabox = saved.instabox
})

test('a resume that fails on a Box out of CPU and memory says so, and notes it on the Box', async () => {
  pressure = { cpu: true, memory: true }
  await expect(resumeBox('u1', 'd1')).rejects.toMatchObject({
    status: 503,
    message:
      'The computer ran out of CPU and memory and stopped answering. Try again in a few minutes.',
  })
  expect(writes).toEqual([
    [
      { userId: 'u1', deviceId: 'd1', box: { $exists: true } },
      { $set: { 'box.pressure': { at: expect.any(Date), cpu: true, memory: true } } },
    ],
  ])
})

test('names only the resource that ran out', async () => {
  pressure = { cpu: false, memory: true }
  await expect(resumeBox('u1', 'd1')).rejects.toMatchObject({
    message: 'The computer ran out of memory and stopped answering. Try again in a few minutes.',
  })
})

test('a Box with headroom keeps the message it had, and nothing is noted', async () => {
  pressure = undefined
  await expect(resumeBox('u1', 'd1')).rejects.toMatchObject({
    message: 'Could not resume the computer. Try again in a few minutes.',
  })
  expect(writes).toEqual([])
})

test('a metrics read that fails does not guess', async () => {
  pressure = new Error('instabox answered 502')
  await expect(resumeBox('u1', 'd1')).rejects.toMatchObject({
    message: 'Could not resume the computer. Try again in a few minutes.',
  })
  expect(writes).toEqual([])
})
