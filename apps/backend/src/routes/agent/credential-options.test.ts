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

const { getAgentCredentialOptions } = await import('./credential-options')
const { resolveDeviceOptions } = await import('./credential-options-devices')

const day = (n: number) => new Date(Date.UTC(2026, 9, n))

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
  test("offers the requester's own devices, available only when online and opted in", async () => {
    devices = [
      device({ deviceId: 'd1', label: 'Online' }),
      device({ deviceId: 'd2', label: 'Offline' }),
      device({ deviceId: 'd3', label: 'Master switch off', allowLocalExec: false }),
      device({ userId: 'u2', deviceId: 'd4', label: "Someone else's device" }),
    ]
    online = new Set(['u1:d1', 'u1:d3', 'u2:d4'])

    expect(await resolveDeviceOptions('u1', 't1')).toEqual([
      { deviceId: 'd1', label: 'Online', platform: 'darwin', available: true },
      { deviceId: 'd2', label: 'Offline', platform: 'darwin', available: false },
      { deviceId: 'd3', label: 'Master switch off', platform: 'darwin', available: false },
    ])
  })

  test('collapses dead registrations of the same computer, keeping the live one', async () => {
    devices = [
      device({ deviceId: 'old-1', label: 'MacBook', updatedAt: day(1) }),
      device({ deviceId: 'live', label: 'MacBook', updatedAt: day(2) }),
      device({ deviceId: 'old-2', label: 'MacBook', updatedAt: day(3) }),
      // Same label, other platform: another computer.
      device({ deviceId: 'pc', label: 'MacBook', platform: 'win32', updatedAt: day(1) }),
      // None of these is online: the newest stands for the computer.
      device({ deviceId: 'cli-1', label: 'host', updatedAt: day(4) }),
      device({ deviceId: 'cli-2', label: 'host', updatedAt: day(5) }),
    ]
    online = new Set(['u1:live'])

    expect((await resolveDeviceOptions('u1', 't1')).map((d) => [d.deviceId, d.available])).toEqual([
      ['live', true],
      ['pc', false],
      ['cli-2', false],
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
