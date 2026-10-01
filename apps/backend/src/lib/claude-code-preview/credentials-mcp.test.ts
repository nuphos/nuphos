import { describe, expect, test } from 'bun:test'

import { useCredentialListing } from '@/lib/test/doubles/claude-code-credential-listing'

import { CREDENTIALS_MCP_SURFACE, credentialsMcpTools, previewSessionEnv } from './credentials-mcp'

import type { ClaudeCodeCredentialEntry, UnselectedCredentialEntry } from './credential-listing'

const listing: { entries: ClaudeCodeCredentialEntry[]; unselected: UnselectedCredentialEntry[] } = {
  entries: [],
  unselected: [],
}

useCredentialListing({
  listSelectedCredentials: () => Promise.resolve(listing.entries),
  listSessionCredentials: () =>
    Promise.resolve({ selected: listing.entries, unselected: listing.unselected }),
})

const agent = { userId: 'user-1', sessionId: 'conv-1' }

const awsEntry: ClaudeCodeCredentialEntry = {
  provider: 'aws',
  id: 'role-1',
  label: 'prod (123456789012)',
  credentialPath: 'aws-accounts/123456789012/credentials',
}

describe('credentialsMcpTools', () => {
  test('session environment supports native Plan and provider scripts with one scoped token', () => {
    expect(
      previewSessionEnv({
        base: 'https://backend.example',
        mount: 'https://backend.example/agent-sessions/conv-1/teams/team-1',
        token: 'scoped',
        conversationId: 'conv-1',
        teamId: 'team-1',
      }),
    ).toEqual({
      NUPHOS_RUNTIME_SKILLS_URL:
        'https://backend.example/internal/claude-code-runtime-skills/team-1',
      NUPHOS_RUNTIME_SKILLS_TOKEN: expect.any(String),
      NUPHOS_TOKEN: 'scoped',
      NUPHOS_BACKEND_URL: 'https://backend.example',
      NUPHOS_SESSION_ID: 'conv-1',
      TEAM: 'team-1',
      NUPHOS_TEAM_ID: 'team-1',
      NUPHOS_PLAN_API_BASE: 'https://backend.example/agent-sessions/conv-1/teams/team-1/plans',
      NUPHOS_PLAN_API_TOKEN: 'scoped',
    })
  })

  test('surface advertises exactly the two credential tools', () => {
    const names = CREDENTIALS_MCP_SURFACE.toolDefinitions.map((t) => (t as { name: string }).name)

    expect(names.toSorted((a, b) => a.localeCompare(b))).toEqual([
      'get_credential',
      'list_credentials',
    ])
  })

  test('list_credentials returns provider/id/label without the vending path', async () => {
    listing.entries = [awsEntry]
    const tools = credentialsMcpTools(agent, 'team-1', () => {
      throw new Error('list must not vend')
    })
    const result = await tools.list_credentials!({})

    expect(result.structuredContent).toEqual({
      credentials: [{ provider: 'aws', id: 'role-1', label: 'prod (123456789012)' }],
    })
  })

  test('list_credentials marks team credentials this conversation has not selected', async () => {
    const gcp: UnselectedCredentialEntry = {
      provider: 'gcp',
      id: 'sa-1',
      label: 'proj (sa@proj.iam.gserviceaccount.com)',
      selected: false,
      hint: 'Not enabled for this conversation. Ask the user to tick it.',
    }

    listing.entries = [awsEntry]
    listing.unselected = [gcp]
    const tools = credentialsMcpTools(agent, 'team-1', () => {
      throw new Error('an unselected credential must never be vended')
    })
    const listed = await tools.list_credentials!({})

    expect(listed.structuredContent).toEqual({
      credentials: [{ provider: 'aws', id: 'role-1', label: 'prod (123456789012)' }],
      notSelected: [gcp],
    })

    const fetched = await tools.get_credential!({ provider: 'gcp', id: 'sa-1' })

    expect(fetched.isError).toBe(true)
    expect(fetched.content[0]?.text).toContain('notSelected')
    listing.unselected = []
  })

  test('get_credential vends through the listed entry path and parses JSON', async () => {
    listing.entries = [awsEntry]
    const vended: string[] = []
    const tools = credentialsMcpTools(agent, 'team-1', (credentialPath) => {
      vended.push(credentialPath)

      return Promise.resolve({
        status: 200,
        body: JSON.stringify({ accessKeyId: 'AKIA', expiresAt: 'soon' }),
      })
    })
    const result = await tools.get_credential!({ provider: 'aws', id: 'role-1' })

    expect(vended).toEqual(['aws-accounts/123456789012/credentials'])
    expect(result.structuredContent).toEqual({
      provider: 'aws',
      id: 'role-1',
      label: 'prod (123456789012)',
      credential: { accessKeyId: 'AKIA', expiresAt: 'soon' },
    })
  })

  test('get_credential refuses anything outside the live selection', async () => {
    listing.entries = [awsEntry]
    const tools = credentialsMcpTools(agent, 'team-1', () => {
      throw new Error('must not vend an unselected credential')
    })

    const wrongId = await tools.get_credential!({ provider: 'aws', id: 'other-role' })

    expect(wrongId.isError).toBe(true)

    const missingArgs = await tools.get_credential!({ provider: 'aws' })

    expect(missingArgs.isError).toBe(true)
  })

  test('usage-only entries list their note and are never vended', async () => {
    listing.entries = [
      {
        provider: 'device',
        id: 'dev-1',
        label: 'MacBook (darwin)',
        usage: 'Local machine; run commands on it with the local_exec tool, device=dev-1.',
      },
    ]
    const tools = credentialsMcpTools(agent, 'team-1', () => {
      throw new Error('must not vend a usage-only entry')
    })
    const listed = await tools.list_credentials!({})

    expect(listed.structuredContent).toEqual({ credentials: listing.entries })

    const fetched = await tools.get_credential!({ provider: 'device', id: 'dev-1' })

    expect(fetched.isError).toBe(true)
    expect(fetched.content[0]?.text).toContain('local_exec')
  })

  test('get_credential surfaces a vending failure as a tool error', async () => {
    listing.entries = [awsEntry]
    const tools = credentialsMcpTools(agent, 'team-1', () =>
      Promise.resolve({ status: 403, body: 'aws_account_agent_access_denied' }),
    )
    const result = await tools.get_credential!({ provider: 'aws', id: 'role-1' })

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('403')
  })
})
