import { InstaboxError, Sandbox } from '@insforge/instabox-sdk'
import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'

import { config } from '@/config'
import { useAgentDeviceStore } from '@/lib/test/doubles/agent-devices-store'

import { pauseBox } from './box-instabox'

import type { AgentDevice } from './store'

// instabox's own text can carry CLI hints and the account owner's email.
const raw = 'machine is locked by owner@example.test; run `instabox unlock m_1`'
const running = {
  deviceId: 'd1',
  box: {
    provider: 'instabox',
    teamId: '65f000000000000000000001',
    sandboxId: 'm_1',
    createdBy: 'u1',
  },
} as unknown as AgentDevice

useAgentDeviceStore({ getAgentDevice: () => Promise.resolve(running) })

const saved = config.box.instabox

beforeEach(() => {
  config.box.instabox = { apiKey: 'test' }
})

afterEach(() => {
  config.box.instabox = saved
})

test('a failed instabox call is a 503 that says what failed, without instabox’s own text', async () => {
  const connect = spyOn(Sandbox, 'connect').mockRejectedValue(
    new InstaboxError(raw, { status: 423 }),
  )

  const error = await pauseBox('u1', 'd1').then(
    () => null,
    (e: unknown) => e as { status: number; code: string; message: string },
  )

  connect.mockRestore()
  expect(error).toMatchObject({ status: 503, code: 'box_unavailable' })
  expect(error?.message).toBe('Could not pause the computer. Try again in a few minutes.')
})
