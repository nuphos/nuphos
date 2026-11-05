import { describe, expect, test } from 'bun:test'

import { mintPreviewMcpToken } from '@/lib/claude-code-preview/mcp-token'
import { agentSessions } from '@/routes/agent-sessions'

// A token exchanged for `credential:aws/role-1` (#1546). The native tools,
// plans and file transfers build their own context from the conversation, so
// they must refuse it before any handler runs.
const limited = () =>
  mintPreviewMcpToken({
    userId: '64b000000000000000000001',
    sessionId: 'conv-1',
    teamId: 'team-1',
    credentialLimit: { awsRoleIds: ['role-1'] },
    resources: ['credential:aws/role-1'],
  })

async function call(method: string, suffix: string, token: string) {
  const response = await agentSessions.request(`/conv-1/teams/team-1${suffix}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(method === 'POST' ? { body: '{}' } : {}),
  })

  const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } }

  return `${String(response.status)} ${body.error?.message ?? ''}`
}

const PATH_DENIED = '403 This token is not valid for this path'

describe('a limited token on the agent-session mount', () => {
  test('is refused by the native tools, plans and file transfers', async () => {
    const token = await limited()

    expect(await call('POST', '/mcp-tools', token)).toBe(PATH_DENIED)
    expect(await call('GET', '/plans', token)).toBe(PATH_DENIED)
    expect(await call('POST', '/file-transfers', token)).toBe(PATH_DENIED)
  })

  test('an unlimited token passes the path check on the same routes', async () => {
    const token = await mintPreviewMcpToken({
      userId: '64b000000000000000000001',
      sessionId: 'conv-1',
      teamId: 'team-1',
    })

    expect(await call('POST', '/mcp-tools', token)).not.toBe(PATH_DENIED)
  })
})
