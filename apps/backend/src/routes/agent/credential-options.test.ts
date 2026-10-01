import { beforeEach, describe, expect, test } from 'bun:test'

import { useAgentDevicePresence } from '@/lib/test/doubles/agent-devices-presence'
import { useAgentDeviceStore } from '@/lib/test/doubles/agent-devices-store'

import type { AgentDevice } from '@/lib/agent/devices/store'

let devices: AgentDevice[]
let online: Set<string>

useAgentDeviceStore({
  listAgentDevicesForUser: async (userId) => devices.filter((device) => device.userId === userId),
  isActiveTeamMember: async (_userId, teamId) => teamId === 't1',
})
useAgentDevicePresence({
  isDevicePresent: async (userId, deviceId) => online.has(`${userId}:${deviceId}`),
})

const { getAgentCredentialOptions, resolveDeviceOptions } = await import('./credential-options')

function device(overrides: Partial<AgentDevice>): AgentDevice {
  return {
    userId: 'u1',
    deviceId: 'd1',
    label: 'Device',
    platform: 'darwin',
    allowLocalExec: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

beforeEach(() => {
  devices = []
  online = new Set()
})

describe('agent credential options: devices', () => {
  test('offers only online, opted-in devices of the requester', async () => {
    devices = [
      device({ deviceId: 'd1', label: 'Online' }),
      device({ deviceId: 'd2', label: 'Offline' }),
      device({ deviceId: 'd3', label: 'Master switch off', allowLocalExec: false }),
      device({ userId: 'u2', deviceId: 'd4', label: "Someone else's device" }),
    ]
    online = new Set(['u1:d1', 'u1:d3', 'u2:d4'])

    expect(await resolveDeviceOptions('u1', 't1')).toEqual([
      { deviceId: 'd1', label: 'Online', platform: 'darwin' },
    ])
  })

  test('offers no devices in a team the requester is not in', async () => {
    devices = [device({ deviceId: 'd1' })]
    online = new Set(['u1:d1'])

    expect(await resolveDeviceOptions('u1', 't2')).toEqual([])
  })

  test('offers no devices outside a team', async () => {
    devices = [device({ deviceId: 'd1' })]
    online = new Set(['u1:d1'])

    const options = await getAgentCredentialOptions(undefined, 'u1')

    expect(options.devices).toEqual([])
  })
})
