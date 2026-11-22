import { InstaboxError, Sandbox } from '@insforge/instabox-sdk'
import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'

import { config } from '@/config'
import { useAgentDeviceStore } from '@/lib/test/doubles/agent-devices-store'
import { useBoxInstaboxAccount } from '@/lib/test/doubles/box-instabox-account'
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

const installStore = useAgentDeviceStore({ getAgentDevice: () => Promise.resolve(box) })
const installAccount = useBoxInstaboxAccount({})

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
  const own = { ...box, box: { ...box.box, accountId: 'a1' } } as AgentDevice

  installStore({ getAgentDevice: () => Promise.resolve(own) })
  installAccount({ boxConnection: () => Promise.resolve({ apiKey: 'team' } as never) })
  try {
    // The team's own instabox account: only the team can clean it up, so it hears.
    await expect(destroyBox('u1', 'd1')).resolves.toBe(false)
    expect(kill).toHaveBeenCalledTimes(1)
  } finally {
    kill.mockRestore()
  }
})

test("a machine left on the deployment's account is Nuphos's to clean up, not the team's", async () => {
  const kill = spyOn(Sandbox, 'kill').mockRejectedValue(new Error('instabox is down'))

  try {
    await expect(destroyBox('u1', 'd1')).resolves.toBe(true)
  } finally {
    kill.mockRestore()
  }
})

test('a machine still pausing keeps its computer, for a delete a minute later', async () => {
  const conflict = new InstaboxError('machine has an active suspend operation', {
    status: 409,
    code: 'operation_conflict',
  })
  const kill = spyOn(Sandbox, 'kill').mockRejectedValue(conflict)
  const connect = spyOn(Sandbox, 'connect').mockResolvedValue({
    getInfo: () => Promise.resolve({ state: 'suspended' }),
  } as unknown as Sandbox)

  try {
    await expect(destroyBox('u1', 'd1')).rejects.toMatchObject({ status: 409, code: 'box_busy' })
    expect(kill).toHaveBeenCalledTimes(2)
  } finally {
    kill.mockRestore()
    connect.mockRestore()
  }
})
