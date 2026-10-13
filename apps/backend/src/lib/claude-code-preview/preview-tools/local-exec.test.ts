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
    { deviceId: 'mac', label: 'MacBook', platform: 'darwin' },
    { deviceId: 'pc', label: 'Desktop PC', platform: 'win32' },
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
  deviceIds: ['mac', 'gone'],
  updatedAt: new Date(),
  updatedBy: 'u1',
}

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

  test('offers only devices that are both selected and available', async () => {
    expect(await resolveAvailableLocalExecDevices({ ...ctx, localTools: false })).toEqual([
      { deviceId: 'mac', label: 'MacBook' },
    ])
  })
})
