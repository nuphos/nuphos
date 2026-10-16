import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'

import { Sandbox } from '@insforge/instabox-sdk'

import { config } from '@/config'
import { useAgentDevicePresence } from '@/lib/test/doubles/agent-devices-presence'
import { useAgentDeviceStore } from '@/lib/test/doubles/agent-devices-store'
import { useDb } from '@/lib/test/doubles/db'

import { resumeBox, wakeBox } from './box-instabox'

import type { AgentDevice } from './store'
import type * as dbActual from '@/lib/db'

// A paused 4-vCPU Box in a team whose other running Box already uses the 4-vCPU limit.
const teamId = '65f000000000000000000001'
const paused = {
  deviceId: 'd1',
  box: { provider: 'instabox', teamId, sandboxId: 'm_paused', createdBy: 'u1' },
} as unknown as AgentDevice

useDb({
  db: (() => ({
    collection: () => ({
      findOne: () => Promise.resolve({ boxVcpuLimit: 4 }),
      updateOne: () => Promise.resolve({ matchedCount: 1 }),
    }),
  })) as unknown as typeof dbActual.db,
})
useAgentDeviceStore({
  getAgentDevice: () => Promise.resolve(paused),
  countTeamBoxesOrdering: () => Promise.resolve(0),
})
useAgentDevicePresence({ isDevicePresent: () => Promise.resolve(false) })

const saved = { instabox: config.box.instabox, backend: config.agent.publicBackendUrl }
let connect: ReturnType<typeof spyOn>

beforeEach(() => {
  config.box.instabox = { apiKey: 'test-key' }
  config.agent.publicBackendUrl = 'https://api.example.test'
  spyOn(Sandbox, 'list').mockResolvedValue([
    { sandboxId: 'm_other', state: 'running', machine: { spec: { vcpus: 4 } } },
    { sandboxId: 'm_paused', state: 'suspended', machine: { spec: { vcpus: 4 } } },
  ] as never)
  connect = spyOn(Sandbox, 'connect').mockRejectedValue(new Error('must not start'))
})

// Config is shared by every test file in this process: put it back after each case.
afterEach(() => {
  config.box.instabox = saved.instabox
  config.agent.publicBackendUrl = saved.backend
  connect.mockRestore()
})

test('resuming a paused Box over the team limit is refused with 402 and starts nothing', async () => {
  await expect(resumeBox('u1', 'd1')).rejects.toMatchObject({
    status: 402,
    code: 'box_vcpu_limit',
  })
  expect(connect).not.toHaveBeenCalled()
})

test('waking a paused Box over the team limit is refused the same way', async () => {
  await expect(wakeBox('u1', 'd1')).rejects.toMatchObject({ status: 402 })
  expect(connect).not.toHaveBeenCalled()
})
