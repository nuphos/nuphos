import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import {
  useAgentSessionsShared,
  real as realShared,
} from '@/lib/test/doubles/agent-sessions-shared'
import { useAgentsIdentity } from '@/lib/test/doubles/agents-identity'
import { real as realOptions, useCredentialOptions } from '@/lib/test/doubles/credential-options'
import {
  mintPreviewMcpToken,
  scopedPathAllowed,
  verifyPreviewMcpToken,
} from '@/lib/claude-code-preview/mcp-token'
import { registerOauthTokenRoute } from '@/routes/oauth/token'

import { EXCHANGED_TOKEN_MAX_TTL_SEC, TOKEN_EXCHANGE_GRANT } from './token-exchange'

import type { AgentRef } from '@/lib/agents/identity'

const JWT = 'urn:ietf:params:oauth:token-type:jwt'
const app = new Hono()

registerOauthTokenRoute(app)

const selection = {
  awsRoleIds: ['role-1', 'role-2'],
  linearWorkspaceIds: ['ws-1'],
  vantaIntegrationIds: ['vanta-1'],
}
const baseOptions = await realOptions.getAgentCredentialOptions(undefined, 'user-1')

useAgentsIdentity({
  verifyAgentForActor: async (userId, owner, sessionId) =>
    sessionId === 'gone' ? null : { userId, sessionId, conversationOwnerUserId: owner },
})
useCredentialOptions({
  getAgentCredentialOptions: async () =>
    ({
      ...baseOptions,
      awsRoles: ['role-1', 'role-2', 'role-3'].map((roleId) => ({ roleId, accountId: roleId })),
      linearWorkspaces: [{ workspaceId: 'ws-1', label: 'Zeabur' }],
      vantaIntegrations: [{ integrationId: 'vanta-1', label: 'Vanta' }],
    }) as never,
})
useAgentSessionsShared({
  getAgentCredentialAccess: async (agent: AgentRef) => {
    const access = { ...emptyAccess(), ...selection }

    return agent.credentialLimit
      ? realShared.limitCredentialAccess(access, agent.credentialLimit)
      : access
  },
})

function emptyAccess() {
  return {
    awsRoleIds: [] as string[],
    linearWorkspaceIds: [] as string[],
    githubInstallationIds: undefined as string[] | undefined,
  }
}

const subject = (ttlSec?: number, sessionId = 'conv-1') =>
  mintPreviewMcpToken({ userId: 'user-1', sessionId, teamId: 'team-1', ttlSec })

async function exchange(fields: Record<string, string | string[]>) {
  const body = new URLSearchParams()

  for (const [key, value] of Object.entries({
    grant_type: TOKEN_EXCHANGE_GRANT,
    subject_token_type: JWT,
    ...fields,
  })) {
    for (const item of Array.isArray(value) ? value : [value]) body.append(key, item)
  }
  const res = await app.request('/token', { method: 'POST', body })

  return { status: res.status, json: (await res.json()) as Record<string, unknown> }
}

describe('token exchange', () => {
  test('narrows a conversation token to the credentials it names', async () => {
    const { status, json } = await exchange({
      subject_token: await subject(),
      resource: 'credential:aws/role-1',
    })

    expect(status).toBe(200)
    expect(json).toMatchObject({ issued_token_type: JWT, token_type: 'Bearer' })
    expect(json).not.toHaveProperty('refresh_token')
    expect(json.expires_in).toBe(EXCHANGED_TOKEN_MAX_TTL_SEC)
    const claims = verifyPreviewMcpToken(json.access_token as string)

    expect(claims).toMatchObject({
      sid: 'conv-1',
      tid: 'team-1',
      aud: ['nuphos-preview-mcp', 'credential:aws/role-1'],
      act: { sub: 'session:conv-1' },
    })
    expect(claims?.lim?.awsRoleIds).toEqual(['role-1'])
    expect(claims?.lim?.linearWorkspaceIds).toEqual([])
  })

  test('refuses credentials the subject cannot vend', async () => {
    const { status, json } = await exchange({
      subject_token: await subject(),
      resource: ['credential:aws/role-1', 'credential:aws/role-3'],
    })

    expect(status).toBe(400)
    expect(json.error).toBe('invalid_target')
    expect(json.error_description).toContain('credential:aws/role-3')
  })

  test('a token limited to credential A cannot be widened to credential B', async () => {
    const narrowed = await exchange({
      subject_token: await subject(),
      resource: 'credential:aws/role-1',
      actor: 'desktop:client-1',
    })
    const widen = await exchange({
      subject_token: narrowed.json.access_token as string,
      resource: 'credential:aws/role-2',
    })

    expect(widen.status).toBe(400)
    expect(widen.json.error).toBe('invalid_target')

    // Without resources the result keeps the subject's limit and extends the actor chain.
    const again = await exchange({
      subject_token: narrowed.json.access_token as string,
      actor: 'cli:c',
    })
    const claims = verifyPreviewMcpToken(again.json.access_token as string)

    expect(claims?.lim?.awsRoleIds).toEqual(['role-1'])
    expect(claims?.act).toEqual({ sub: 'cli:c', act: { sub: 'desktop:client-1' } })
  })

  test('caps the lifetime at 30 minutes and at the subject', async () => {
    const tooLong = await exchange({ subject_token: await subject(), expires_in: '3600' })

    expect(tooLong.status).toBe(400)
    expect(tooLong.json.error).toBe('invalid_request')
    const shortSubject = await subject(300)
    const outlives = await exchange({ subject_token: shortSubject, expires_in: '600' })

    expect(outlives.status).toBe(400)
    const fitted = await exchange({ subject_token: shortSubject })
    const claims = verifyPreviewMcpToken(fitted.json.access_token as string)
    const parent = verifyPreviewMcpToken(shortSubject)

    expect(fitted.status).toBe(200)
    expect(claims?.exp).toBeLessThanOrEqual(parent!.exp)
  })

  test('rejects another team, an invalid subject and a missing conversation', async () => {
    const team = await exchange({ subject_token: await subject(), team_id: 'team-2' })
    const invalid = await exchange({ subject_token: 'not-a-token' })
    const gone = await exchange({ subject_token: await subject(undefined, 'gone') })
    const actor = await exchange({ subject_token: await subject(), actor: 'anyone' })
    const resource = await exchange({ subject_token: await subject(), resource: 'aws/role-1' })

    expect([team.json.error, invalid.json.error, gone.json.error]).toEqual([
      'invalid_target',
      'invalid_grant',
      'invalid_grant',
    ])
    expect(actor.json.error).toBe('invalid_request')
    expect(resource.json.error).toBe('invalid_target')
  })
})

describe('limitCredentialAccess', () => {
  test('intersects selections and narrows team-wide fields to the limit', () => {
    const limited = realShared.limitCredentialAccess(
      {
        awsRoleIds: ['role-1', 'role-2'],
        linearWorkspaceIds: ['ws-1'],
        githubInstallationIds: undefined,
      } as Record<string, string[] | undefined>,
      { awsRoleIds: ['role-2'], githubInstallationIds: ['gh-1'] },
    )

    expect(limited).toEqual({
      awsRoleIds: ['role-2'],
      linearWorkspaceIds: [],
      githubInstallationIds: ['gh-1'],
    })
  })
})

describe('limited tokens vend credentials only', () => {
  const claims = { sid: 'conv-1', tid: 'team-1', lim: { awsRoleIds: ['role-1'] } }
  const mount = '/agent-sessions/conv-1/teams/team-1'

  test('credential routes, the credentials MCP and the selection stay open', () => {
    for (const suffix of [
      '/mcp',
      '/selected-credentials',
      '/aws-accounts/123/credentials',
      '/linode-accounts/abc/credentials',
      '/tencent-accounts/t1/credentials',
    ]) {
      expect(scopedPathAllowed(`${mount}${suffix}`, claims)).toBe(true)
    }
  })

  test('native tools, plans and file transfers are refused', () => {
    for (const suffix of ['/mcp-tools', '/plans/1', '/file-transfers/x', '/aws-accounts']) {
      expect(scopedPathAllowed(`${mount}${suffix}`, claims)).toBe(false)
      // Unlimited conversation tokens keep their access.
      expect(scopedPathAllowed(`${mount}${suffix}`, { sid: 'conv-1', tid: 'team-1' })).toBe(true)
    }
  })
})

test('a repeated single-valued field keeps its last value', async () => {
  const { status } = await exchange({
    subject_token: ['ignored', await subject()],
    resource: 'credential:aws/role-1',
  })

  expect(status).toBe(200)
})

test('refuses credentials a limited token could not use', async () => {
  const { status, json } = await exchange({
    subject_token: await subject(),
    resource: ['credential:aws/role-1', 'credential:vanta/vanta-1'],
  })

  expect(status).toBe(400)
  expect(json.error).toBe('invalid_target')
  expect(json.error_description).toContain('Cannot be delegated to a limited token')
  expect(json.error_description).toContain('credential:vanta/vanta-1')
})
