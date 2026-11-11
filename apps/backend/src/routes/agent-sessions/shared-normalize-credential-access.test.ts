import { describe, expect, test } from 'bun:test'

import { intersectTriggerCredentialAccess } from '@/lib/agent/trigger-credential-access'

import { normalizeCredentialAccess } from './shared'

import type { AgentCredentialAccess } from '@/lib/agent/db'

const stamp = { updatedAt: new Date(0), updatedBy: 'user-1' }
const held = (stored: Record<string, unknown>) =>
  ({ ...stamp, ...normalizeCredentialAccess(stored) }) as AgentCredentialAccess

describe('normalizeCredentialAccess', () => {
  test('a stored null connector list reaches nothing, never team-wide', () => {
    const access = normalizeCredentialAccess({ githubInstallationIds: null, awsRoleIds: null })

    expect(access.githubInstallationIds).toEqual([])
    expect(access.awsRoleIds).toEqual([])
  })

  test('keeps an absent connector list absent and an explicit empty one empty', () => {
    const access = normalizeCredentialAccess({ gitlabBindingIds: [] })

    expect(access.githubInstallationIds).toBeUndefined()
    expect(access.gitlabBindingIds).toEqual([])
    expect(access.awsRoleIds).toEqual([])
  })

  test('a malformed scalar or a non-id entry fails closed', () => {
    const access = normalizeCredentialAccess({
      cloudflareAccountIds: 'acct-1',
      grafanaInstanceIds: 7,
      notionIntegrationIds: { id: 'n-1' },
      gcpServiceAccountIds: 'sa-1',
      awsRoleIds: ['role-1', null, 3, 'role-2'],
      personalCredentialIds: ['github', 'gmail', null],
    })

    expect(access.cloudflareAccountIds).toEqual([])
    expect(access.grafanaInstanceIds).toEqual([])
    expect(access.notionIntegrationIds).toEqual([])
    expect(access.gcpServiceAccountIds).toEqual([])
    expect(access.awsRoleIds).toEqual(['role-1', 'role-2'])
    expect(access.personalCredentialIds).toEqual(['github'])
  })

  test('leaves well-formed lists unchanged', () => {
    const access = normalizeCredentialAccess({
      awsRoleIds: ['role-1'],
      githubInstallationIds: ['inst-1'],
    })

    expect(access.awsRoleIds).toEqual(['role-1'])
    expect(access.githubInstallationIds).toEqual(['inst-1'])
  })
})

describe('a panel with no selection, held to a conversation with a stored null list', () => {
  test('intersects without throwing and grants nothing for that connector', () => {
    const current = held({ githubInstallationIds: null, awsRoleIds: ['role-1'] })
    const access = intersectTriggerCredentialAccess(current, current)

    expect(access.githubInstallationIds).toEqual([])
    expect(access.awsRoleIds).toEqual(['role-1'])
  })

  test('still narrows a selection to what the conversation holds', () => {
    const approved = held({ awsRoleIds: ['role-1', 'role-2'], githubInstallationIds: ['inst-1'] })
    const current = held({ awsRoleIds: ['role-2'], githubInstallationIds: null })
    const access = intersectTriggerCredentialAccess(approved, current)

    expect(access.awsRoleIds).toEqual(['role-2'])
    expect(access.githubInstallationIds).toEqual([])
    expect(access.gitlabBindingIds).toBeUndefined()
  })
})
