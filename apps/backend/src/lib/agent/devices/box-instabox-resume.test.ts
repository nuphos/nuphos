import { afterEach, beforeEach, expect, test } from 'bun:test'

import { config } from '@/config'
import { AppError } from '@/lib/errors'
import { useAgentDevicePresence } from '@/lib/test/doubles/agent-devices-presence'
import { useAgentDeviceStore } from '@/lib/test/doubles/agent-devices-store'
import { useBoxInstaboxLimit } from '@/lib/test/doubles/box-instabox-limit'

import { resumeBox, wakeBox } from './box-instabox'

import type { AgentDevice } from './store'

// A paused Box whose team is already at its vCPU limit: the limit check refuses the start.
const teamId = '65f000000000000000000001'
const paused = {
  deviceId: 'd1',
  box: { provider: 'instabox', teamId, sandboxId: 'm_paused', createdBy: 'u1' },
} as unknown as AgentDevice
const checked: [string, unknown][] = []

useAgentDeviceStore({ getAgentDevice: () => Promise.resolve(paused) })
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
