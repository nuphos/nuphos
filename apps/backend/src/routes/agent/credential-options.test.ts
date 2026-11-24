import { beforeEach, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useAgentDevicePresence } from '@/lib/test/doubles/agent-devices-presence'
import { useAgentDeviceStore } from '@/lib/test/doubles/agent-devices-store'
import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'

import type { AgentDevice } from '@/lib/agent/devices/store'
import type { NuphosTeamRole } from '@/lib/identity/types'

let devices: AgentDevice[]
let online: Set<string>
let membershipRole: NuphosTeamRole | null = 'ADMINISTRATOR'
let mcpRows: { _id: ObjectId; teamId: string; name: string; url: string; createdAt: Date }[] = []

useDb({
  db: () => ({
    collection: (name: string) => ({
      find: (filter: { teamId?: string }) => {
        const list = async () =>
          name === 'team_mcp_servers' ? mcpRows.filter((row) => row.teamId === filter.teamId) : []

        return {
          sort: () => ({ toArray: list }),
          toArray: list,
        }
      },
    }),
  }),
})
useIdentity({
  getTeamMembership: async (_userId, teamId) =>
    teamId === 't1' && membershipRole ? { role: membershipRole, team: {} } : null,
})
useAgentDeviceStore({
  listAgentDevicesForUser: async (userId) => devices.filter((device) => device.userId === userId),
  isActiveTeamMember: async (_userId, teamId) => teamId === 't1',
})
useAgentDevicePresence({
  isDevicePresent: async (userId, deviceId) => online.has(`${userId}:${deviceId}`),
})

const { getAgentCredentialOptions, resolveDeviceOptions, resolveMcpServerOptions } =
  await import('./credential-options')

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
  membershipRole = 'ADMINISTRATOR'
  mcpRows = []
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
    expect(options.mcpServers).toEqual([])
  })
})

describe('agent credential options: custom MCP servers', () => {
  test('returns team MCP servers with URL only to team administrators', async () => {
    const ownId = new ObjectId()
    const foreignId = new ObjectId()

    mcpRows = [
      {
        _id: ownId,
        teamId: 't1',
        name: 'homelab',
        url: 'https://mcp.internal.example/mcp',
        createdAt: new Date(1),
      },
      {
        _id: foreignId,
        teamId: 't2',
        name: 'foreign',
        url: 'https://foreign.example/mcp',
        createdAt: new Date(2),
      },
    ]

    membershipRole = 'ADMINISTRATOR'
    expect(await resolveMcpServerOptions('t1', 'u1')).toEqual([
      { id: ownId.toHexString(), name: 'homelab', url: 'https://mcp.internal.example/mcp' },
    ])

    for (const nonAdmin of ['EDITOR', 'VIEWER', null] as const) {
      membershipRole = nonAdmin
      const list = await resolveMcpServerOptions('t1', 'u1')

      expect(list).toEqual([])
      expect(JSON.stringify(list)).not.toContain('mcp.internal.example')
    }
  })
})
