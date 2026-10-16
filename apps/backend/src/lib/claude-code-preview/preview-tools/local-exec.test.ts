import { useAgentDeviceStore } from '@/lib/test/doubles/agent-devices-store'
import { useIdentity } from '@/lib/test/doubles/identity'
import type { TeamMembership } from '@/lib/identity/types'
import { describe, expect, test } from 'bun:test'

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
})
useIdentity({ getTeamMembership: () => Promise.resolve({ role: 'EDITOR' } as TeamMembership) })

useCredentialOptions({ getAgentCredentialOptions: () => Promise.resolve(options) })
useAgentSessionsShared({ getAgentCredentialAccess: () => Promise.resolve(access) })

const { localExecToolModule, resolveAvailableLocalExecDevices } = await import('./local-exec')

const ctx = { userId: 'u1', teamId: 't1', sessionId: 'conv-1', locale: 'en' }

describe('localExecToolModule', () => {
  test('advertises local_exec to a client without local tools, such as iOS', async () => {
    const module = await localExecToolModule(ctx)
    const names = module.definitions.map((definition) => (definition as { name: string }).name)

    expect(names).toEqual(['local_terminal', 'local_exec'])
    expect(Object.keys(module.handlers(ctx))).toEqual(['local_terminal', 'local_exec'])
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
