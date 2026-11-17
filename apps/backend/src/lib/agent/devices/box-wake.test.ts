import { Sandbox } from '@insforge/instabox-sdk'
import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'

import { config } from '@/config'
import { AppError } from '@/lib/errors'
import { useAgentDevicePresence } from '@/lib/test/doubles/agent-devices-presence'
import { useAgentDeviceStore } from '@/lib/test/doubles/agent-devices-store'
import { useBoxInstaboxAccount } from '@/lib/test/doubles/box-instabox-account'
import { useBoxInstaboxLimit } from '@/lib/test/doubles/box-instabox-limit'

import { wakeOfflineBox } from './box-wake'
import { localRuntimeId } from './local-runtime/address'

import type { AgentDevice } from './store'

// An offline, paused Box: waking it checks the team's limit before resuming in the background.
const teamId = '65f000000000000000000001'
const paused = {
  deviceId: 'd1',
  box: { provider: 'instabox', teamId, sandboxId: 'm_paused', createdBy: 'u1' },
} as unknown as AgentDevice
let refuse = false
const checked: [string, string][] = []
const resumed: string[] = []

const installStore = useAgentDeviceStore({ getAgentDevice: () => Promise.resolve(paused) })
const installAccount = useBoxInstaboxAccount({})

useAgentDevicePresence({ isDevicePresent: () => Promise.resolve(false) })
useBoxInstaboxLimit({
  assertCanResume: (team: string, sandboxId: string) => {
    checked.push([team, sandboxId])

    return refuse
      ? Promise.reject(new AppError(402, 'box_vcpu_limit', 'Your team has no Box plan'))
      : Promise.resolve()
  },
  // healBox's background resume: record it and start nothing.
  startWithinLimit: (_team: string, starting: { vcpus: number } | { sandboxId: string }) => {
    resumed.push('sandboxId' in starting ? starting.sandboxId : '')

    return Promise.reject(new Error('not started in this test'))
  },
})

const saved = config.agent.publicBackendUrl

beforeEach(() => {
  checked.length = 0
  resumed.length = 0
  config.agent.publicBackendUrl = 'https://api.example.test'
})

// Config is shared by every test file in this process: put it back after each case.
afterEach(() => {
  config.agent.publicBackendUrl = saved
})

test('a Box the team limit cannot resume is refused with the 402, and nothing is resumed', async () => {
  refuse = true
  await expect(
    wakeOfflineBox(localRuntimeId({ userId: 'u1', deviceId: 'd1', provider: 'claude-code' })),
  ).rejects.toMatchObject({
    status: 402,
    code: 'box_vcpu_limit',
  })
  await Bun.sleep(0)
  expect(checked).toEqual([[teamId, 'm_paused']])
  expect(resumed).toEqual([])
})

test('a Box within the limit resumes in the background and the send may queue', async () => {
  refuse = false
  expect(
    await wakeOfflineBox(localRuntimeId({ userId: 'u1', deviceId: 'd2', provider: 'claude-code' })),
  ).toBe(true)
  await Bun.sleep(0)
  expect(checked).toEqual([[teamId, 'm_paused']])
  expect(resumed).toEqual(['m_paused'])
})

test('a Box on a team account that paused when idle is resumed, host and all, when a turn needs it', async () => {
  // A free instabox plan pauses an idle Box after 30 minutes; a turn for it must bring it back.
  const idle = {
    deviceId: 'd3',
    box: { ...paused.box, accountId: '65f0000000000000000000a1', sandboxId: 'm_idle' },
  } as unknown as AgentDevice
  const ran: string[] = []

  installStore({ getAgentDevice: () => Promise.resolve(idle) })
  installAccount({ boxConnection: () => Promise.resolve({ apiKey: 'k' } as never) })
  const connect = spyOn(Sandbox, 'connect').mockResolvedValue({
    commands: {
      run: (command: string) => {
        ran.push(command)

        return Promise.resolve({})
      },
    },
  } as unknown as Sandbox)

  expect(
    await wakeOfflineBox(localRuntimeId({ userId: 'u1', deviceId: 'd3', provider: 'claude-code' })),
  ).toBe(true)
  await Bun.sleep(0)
  const [sandboxId, options] = connect.mock.calls[0] ?? []

  connect.mockRestore()
  // A team's own account has no Nuphos vCPU limit: no check, just the resume.
  expect(checked).toEqual([])
  expect(sandboxId).toBe('m_idle')
  expect(options).toMatchObject({ resume: true })
  expect(ran.some((command) => command.includes('nuphos agent'))).toBe(true)
})
