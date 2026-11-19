import { InstaboxError, Sandbox } from '@insforge/instabox-sdk'
import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'

import { config } from '@/config'
import { useAgentDeviceStore } from '@/lib/test/doubles/agent-devices-store'
import { useJoinTokens } from '@/lib/test/doubles/join-tokens'

import { destroyBox } from './box-instabox'

import type { AgentDevice } from './store'

const box = {
  deviceId: 'd1',
  box: {
    provider: 'instabox',
    teamId: '65f000000000000000000001',
    sandboxId: 'm_1',
    createdBy: 'u1',
  },
} as unknown as AgentDevice

useAgentDeviceStore({ getAgentDevice: () => Promise.resolve(box) })
useJoinTokens({ deleteDeviceJoinTokens: () => Promise.resolve() })

const saved = config.box.instabox

beforeEach(() => {
  config.box.instabox = { apiKey: 'test' }
})

afterEach(() => {
  config.box.instabox = saved
})

test('a machine instabox will not kill never keeps its computer from being deleted', async () => {
  const kill = spyOn(Sandbox, 'kill').mockRejectedValue(
    new InstaboxError('API key expired', { status: 401 }),
  )

  try {
    await expect(destroyBox('u1', 'd1')).resolves.toBeUndefined()
    expect(kill).toHaveBeenCalledTimes(1)
  } finally {
    kill.mockRestore()
  }
})
