import { describe, expect, test } from 'bun:test'

import { useIdentity } from '@/lib/test/doubles/identity'

import type { NuphosTeamRole } from '@/lib/identity/types'

const ROLES: Record<string, NuphosTeamRole> = {
  admin: 'ADMINISTRATOR',
  editor: 'EDITOR',
  viewer: 'VIEWER',
}

useIdentity({
  getTeamMembership: async (userId: string) => {
    const role = ROLES[userId]

    return role
      ? ({ role } as Awaited<ReturnType<typeof import('@/lib/identity').getTeamMembership>>)
      : null
  },
})

const { canMintCredentials, isCloudCredentialPath } = await import('./credential-role')

describe('canMintCredentials', () => {
  test('allows administrators and editors', async () => {
    expect(await canMintCredentials('team', ['admin', 'editor'])).toBe(true)
  })

  test('refuses when any principal is a viewer or not a member', async () => {
    expect(await canMintCredentials('team', ['editor', 'viewer'])).toBe(false)
    expect(await canMintCredentials('team', ['editor', 'stranger'])).toBe(false)
  })
})

describe('isCloudCredentialPath', () => {
  test.each([
    '/s/teams/t/aws-accounts/123/credentials',
    '/s/teams/t/gcp-projects/p/clusters/c/kubeconfig',
    '/s/teams/t/tencent-accounts/a/credentials',
    '/s/teams/t/tailscale-clients/c/credentials',
    '/s/teams/t/aws-accounts/123/clusters/prod/exec-credential',
    '/s/teams/t/gcp-projects/p/clusters/c/exec-credential',
    '/s/teams/t/tailscale-clients/c/tailnet-sessions',
  ])('matches %s', (path) => {
    expect(isCloudCredentialPath(path)).toBe(true)
  })

  test.each([
    '/s/teams/t/linear-workspaces/w/credentials',
    '/s/teams/t/aws-accounts/123/iam-permissions',
    '/s/teams/t/selected-credentials',
  ])('ignores %s', (path) => {
    expect(isCloudCredentialPath(path)).toBe(false)
  })
})
