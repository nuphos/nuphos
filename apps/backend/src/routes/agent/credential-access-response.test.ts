import { describe, expect, test } from 'bun:test'

import { agentCredentialSelectionSchema } from '@/lib/api/credentials/agent-schemas'

import { credentialAccessResponse } from './credential-access'

import type { AgentCredentialAccess } from '@/lib/agent/db'

describe('credentialAccessResponse', () => {
  test('echoes back every selectable credential kind, including devices', () => {
    const selection = Object.fromEntries(
      Object.keys(agentCredentialSelectionSchema.shape).map((key) => [key, [`${key}-id`]]),
    )
    const access = {
      ...selection,
      updatedAt: new Date('2026-09-23T20:26:44.468Z'),
      updatedBy: 'u1',
    } as unknown as AgentCredentialAccess

    const response = credentialAccessResponse(access)

    for (const key of Object.keys(agentCredentialSelectionSchema.shape)) {
      expect(response).toHaveProperty(key, [`${key}-id`])
    }
    expect(response.deviceIds).toEqual(['deviceIds-id'])
    expect(response.azureAccountIds).toEqual(['azureAccountIds-id'])
    expect(response.updatedAt).toBe('2026-09-23T20:26:44.468Z')
    expect(response.updatedBy).toBe('u1')
  })

  test('defaults device ids to an empty list for docs written before devices existed', () => {
    const response = credentialAccessResponse({
      awsRoleIds: [],
      gcpServiceAccountIds: [],
      linodeAccountIds: [],
      hetznerAccountIds: [],
      betterStackIntegrationIds: [],
      uptimeKumaInstanceIds: [],
      jiraSiteIds: [],
      asanaAccountIds: [],
      tailscaleClientIds: [],
      zeaburIds: [],
      vantaIntegrationIds: [],
      secureframeIntegrationIds: [],
      updatedAt: new Date(0),
      updatedBy: 'u1',
    })

    expect(response.deviceIds).toEqual([])
  })
})
