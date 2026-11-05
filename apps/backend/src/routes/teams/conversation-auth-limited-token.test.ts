import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { mintPreviewMcpToken } from '@/lib/claude-code-preview/mcp-token'
import { errorHandler } from '@/lib/errors'
import { useAgentSessionsShared } from '@/lib/test/doubles/agent-sessions-shared'
import { useAgentsIdentity } from '@/lib/test/doubles/agents-identity'

import { dispatchConversationTeamApi, requireUserOrConversationAuth } from './conversation-auth'

useAgentsIdentity({
  verifyAgentForActor: async (userId, owner, sessionId) => ({
    userId,
    sessionId,
    conversationOwnerUserId: owner,
  }),
})
// The selection as the request sees it once a limit to aws/role-1 is applied.
useAgentSessionsShared({
  getAgentCredentialAccess: async () =>
    ({ awsRoleIds: ['role-1'], githubInstallationIds: [] }) as never,
})

const app = new Hono()

app.onError(errorHandler)
app.use('/teams/:teamId/*', requireUserOrConversationAuth, dispatchConversationTeamApi)
app.all('*', (c) => c.text('reached'))

const token = (limited: boolean) =>
  mintPreviewMcpToken({
    userId: '64b000000000000000000001',
    sessionId: 'conv-1',
    teamId: 'team-1',
    ...(limited
      ? { credentialLimit: { awsRoleIds: ['role-1'] }, resources: ['credential:aws/role-1'] }
      : {}),
  })

async function get(path: string, limited = true) {
  const res = await app.request(path, {
    headers: { Authorization: `Bearer ${await token(limited)}` },
  })

  return `${String(res.status)} ${await res.text()}`
}

describe('a limited token on the /teams mount', () => {
  test('is refused on canonical routes that are not one of its connector bindings', async () => {
    // A trigger read carries its webhook secret; it is not a credential this token names.
    expect(await get('/teams/team-1/agent-triggers/t1')).toContain(
      'This token is limited to credentials',
    )
    expect(await get('/teams/team-1/members')).toContain('This token is limited to credentials')
    // A connector binding outside the limit fails the selection check.
    expect(await get('/teams/team-1/github-installations/gh-1')).toMatch(/^403 /u)
  })

  test('an unlimited token still reaches the canonical routes', async () => {
    expect(await get('/teams/team-1/agent-triggers/t1', false)).toBe('200 reached')
  })
})
