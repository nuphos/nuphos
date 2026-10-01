import { describe, expect, test } from 'bun:test'

import { mintPreviewMcpToken, scopedPathAllowed, verifyPreviewMcpToken } from './mcp-token'

describe('preview MCP token', () => {
  test('round-trips its (user, session, team) scope', () => {
    const token = mintPreviewMcpToken({ userId: 'user-1', sessionId: 'conv-1', teamId: 'team-1' })
    const claims = verifyPreviewMcpToken(token)

    expect(claims).toMatchObject({
      sub: 'user-1',
      own: 'user-1',
      sid: 'conv-1',
      tid: 'team-1',
      ori: 'https://api.nuphos.ai',
    })
    // Never the general session-token shape — only conversation-aware
    // middleware may accept it.
    expect(token.split('.')).toHaveLength(3)
  })

  test('binds a shared-channel actor separately from the conversation owner', () => {
    const token = mintPreviewMcpToken({
      userId: 'actor-2',
      conversationOwnerUserId: 'owner-1',
      sessionId: 'conv-1',
      teamId: 'team-1',
    })

    expect(verifyPreviewMcpToken(token)).toMatchObject({
      sub: 'actor-2',
      own: 'owner-1',
      sid: 'conv-1',
      tid: 'team-1',
    })
  })

  test('rejects tampered payloads and garbage', () => {
    const token = mintPreviewMcpToken({ userId: 'user-1', sessionId: 'conv-1', teamId: 'team-1' })
    const [head = '', payload = '', signature = ''] = token.split('.')
    const forged = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      tid: string
    }

    forged.tid = 'team-2'
    const forgedToken = `${head}.${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${signature}`

    expect(verifyPreviewMcpToken(forgedToken)).toBeNull()
    expect(verifyPreviewMcpToken('not-a-token')).toBeNull()
    expect(verifyPreviewMcpToken('')).toBeNull()
  })

  test('rejects expired tokens', () => {
    const token = mintPreviewMcpToken({
      userId: 'user-1',
      sessionId: 'conv-1',
      teamId: 'team-1',
      ttlSec: -10,
    })

    expect(verifyPreviewMcpToken(token)).toBeNull()
  })

  test('binds the token to its API origin', () => {
    const token = mintPreviewMcpToken({
      userId: 'user-1',
      sessionId: 'conv-1',
      teamId: 'team-1',
      apiOrigin: 'https://local-tunnel.example/',
    })

    expect(verifyPreviewMcpToken(token)).toMatchObject({ ori: 'https://local-tunnel.example' })
  })
})

describe('scopedPathAllowed', () => {
  const claims = { sid: 'conv-1', tid: 'team-1' }

  test('accepts everything under the conversation team mount, with or without prefix', () => {
    expect(scopedPathAllowed('/agent-sessions/conv-1/teams/team-1/mcp', claims)).toBe(true)
    expect(scopedPathAllowed('/agent-sessions/conv-1/teams/team-1/mcp-tools', claims)).toBe(true)
    expect(
      scopedPathAllowed(
        '/agent-sessions/conv-1/teams/team-1/aws-accounts/123/clusters/prod/exec-credential',
        claims,
      ),
    ).toBe(true)
    expect(scopedPathAllowed('/conv-1/teams/team-1/aws-accounts/123/credentials', claims)).toBe(
      true,
    )
  })

  test('rejects other sessions, other teams, and non-team paths', () => {
    expect(scopedPathAllowed('/agent-sessions/other/teams/team-1/mcp', claims)).toBe(false)
    expect(scopedPathAllowed('/agent-sessions/conv-1/teams/other/mcp', claims)).toBe(false)
    expect(scopedPathAllowed('/agent-sessions/conv-1/kubeconfig', claims)).toBe(false)
    expect(scopedPathAllowed('/teams/team-1/claude-code-runtimes', claims)).toBe(false)
  })
})
