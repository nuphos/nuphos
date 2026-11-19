import { useAgentDeviceStore } from '@/lib/test/doubles/agent-devices-store'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useLocalRuntimePresence } from '@/lib/test/doubles/local-runtime-presence'
import type { TeamMembership } from '@/lib/identity/types'
import { describe, expect, test } from 'bun:test'

import { createMemoryPresenceStore } from '@/lib/agent/devices/local-runtime/presence'
import { useAgentSessionsShared } from '@/lib/test/doubles/agent-sessions-shared'
import { useCredentialOptions } from '@/lib/test/doubles/credential-options'
import { emptyConnectorCredentialOptions } from '@/routes/agent/credential-options-connectors'

import type { AgentCredentialAccess } from '@/lib/agent/db'
import type { AgentCredentialOptions } from '@/routes/agent/types'

const options: AgentCredentialOptions = {
  awsRoles: [],
  gcpServiceAccounts: [],
  linodeAccounts: [],
  hetznerAccounts: [],
  tencentAccounts: [],
  aliyunAccounts: [],
  volcengineAccounts: [],
  huaweiAccounts: [],
  azureAccounts: [],
  onpremClusters: [],
  betterStackIntegrations: [],
  uptimeKumaInstances: [],
  linearWorkspaces: [],
  jiraSites: [],
  asanaAccounts: [],
  sentryAccounts: [],
  tailscaleClients: [],
  zeaburProviders: [],
  vantaIntegrations: [],
  secureframeIntegrations: [],
  resendIntegrations: [],
  personalCredentials: [],
  devices: [
    { deviceId: 'mac', label: 'MacBook', platform: 'darwin', available: true },
    { deviceId: 'pc', label: 'Desktop PC', platform: 'win32', available: true },
    { deviceId: 'asleep', label: 'Asleep', platform: 'darwin', available: false },
    {
      deviceId: 'box',
      label: 'Box',
      platform: 'linux',
      available: false,
      box: { ready: true },
    },
    {
      deviceId: 'broken',
      label: 'Broken box',
      platform: 'linux',
      available: false,
      box: { ready: false },
    },
  ],
  ...emptyConnectorCredentialOptions(),
}

const access: AgentCredentialAccess = {
  awsRoleIds: [],
  gcpServiceAccountIds: [],
  linodeAccountIds: [],
  hetznerAccountIds: [],
  betterStackIntegrationIds: [],
  uptimeKumaInstanceIds: [],
  tailscaleClientIds: [],
  zeaburIds: [],
  vantaIntegrationIds: [],
  secureframeIntegrationIds: [],
  jiraSiteIds: [],
  asanaAccountIds: [],
  deviceIds: ['mac', 'asleep', 'gone', 'box', 'broken'],
  updatedAt: new Date(),
  updatedBy: 'u1',
}

const fixture = (deviceId: string) => ({
  userId: 'u1',
  deviceId,
  label: deviceId,
  platform: 'linux',
  allowLocalExec: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...(deviceId === 'box' ? { box: { provider: 'instabox' as const, teamId: 't1' } } : {}),
})

useAgentDeviceStore({
  getAgentDevice: (_owner, id) => Promise.resolve(fixture(id)),
  listTeamBoxes: () => Promise.resolve([fixture('box')]),
  findGrantedDevices: () => Promise.resolve([]),
})
useIdentity({ getTeamMembership: () => Promise.resolve({ role: 'EDITOR' } as TeamMembership) })

const credentialOptions = useCredentialOptions({
  getAgentCredentialOptions: () => Promise.resolve(options),
})
const credentialAccess = useAgentSessionsShared({
  getAgentCredentialAccess: () => Promise.resolve(access),
})

const presence = createMemoryPresenceStore()

useLocalRuntimePresence({ runtimePresenceStore: () => presence })

const { localExecToolModule, resolveAvailableLocalExecDevices } = await import('./local-exec')

const ctx = { userId: 'u1', teamId: 't1', sessionId: 'conv-1', locale: 'en' }

describe('localExecToolModule', () => {
  test('advertises local_exec to a client without local tools, such as iOS', async () => {
    const module = await localExecToolModule(ctx)
    const names = module.definitions.map((definition) => (definition as { name: string }).name)

    const tools = ['local_upload', 'local_download', 'local_terminal', 'local_exec']

    expect(names).toEqual(tools)
    expect(Object.keys(module.handlers(ctx))).toEqual(tools)
  })

  test('offers selected devices that are available, and offline Boxes with a wake', async () => {
    const devices = await resolveAvailableLocalExecDevices({ ...ctx, localTools: false })

    expect(devices.map(({ deviceId, label }) => ({ deviceId, label }))).toEqual([
      { deviceId: 'mac', label: 'MacBook' },
      { deviceId: 'box', label: 'Box' },
    ])

    expect(devices.find((d) => d.deviceId === 'mac')?.wake).toBeUndefined()
    expect(typeof devices.find((d) => d.deviceId === 'box')?.wake).toBe('function')
  })
})

test('a shared turn resolves the owner selection instead of the teammate devices', async () => {
  credentialOptions({
    getAgentCredentialOptions: async (_teamId, userId) => {
      expect(userId).toBe('u1')

      return options
    },
  })
  credentialAccess({
    getAgentCredentialAccess: async (agent) => {
      expect(agent.userId).toBe('u1')
      expect(agent.sessionId).toBe('conv-1')

      return access
    },
  })
  const devices = await resolveAvailableLocalExecDevices({
    ...ctx,
    userId: 'teammate',
    conversationOwnerUserId: 'u1',
  })

  expect(devices.map((device) => device.deviceId)).toEqual(['mac', 'box'])
  expect(devices.find((device) => device.deviceId === 'box')?.wake).toBeFunction()
})

test('offers a terminal only on a computer whose runtime reports it can open one', async () => {
  const status = (localTerminal: boolean) => ({ agents: {}, localExec: true, localTerminal })

  await presence.claim('u1', 'mac', 'c1', { conn: 'c1', seenAt: 1, status: status(true) })
  await presence.claim('u1', 'box', 'c2', { conn: 'c2', seenAt: 1, status: status(false) })

  const terminals = await resolveAvailableLocalExecDevices(ctx, 'terminal')
  const devices = await resolveAvailableLocalExecDevices(ctx)

  expect(terminals.map((device) => device.deviceId)).toEqual(['mac'])
  expect(devices.map((device) => device.deviceId)).toEqual(['mac', 'box'])
})
