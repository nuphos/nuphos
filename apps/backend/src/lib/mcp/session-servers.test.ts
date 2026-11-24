import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { config } from '@/config'
import { encryptCustomMcpSecret } from '@/lib/byos/secrets'
import { previewSessionAccess } from '@/lib/claude-code-preview/credentials-mcp'
import { useCredentialListing } from '@/lib/test/doubles/claude-code-credential-listing'
import { useDb } from '@/lib/test/doubles/db'
import { useObservability } from '@/lib/test/doubles/observability'

import { appendMcpServerNotices } from './declaration-budget'
import { listRemoteMcpDeclaration, mcpMessageFromHttp, toolsOf } from './remote-declaration'
import {
  assembleConversationMcpServers,
  customMcpLogFields,
  selectedConversationMcpServers,
} from './session-servers'

import type { TeamMcpServer } from './team-servers'
import type { EncryptedSecret } from '@/lib/byos/secrets'
import type * as dbActual from '@/lib/db'

process.env.CUSTOM_MCP_BYOK_ENCRYPTION_KEY = 'b'.repeat(64)

const SECRET = 'Bearer s3cret-value'
const UNSELECTED = 'Bearer not-selected-secret'
const OTHER_TEAM = 'Bearer other-team-secret'
const BROKEN: EncryptedSecret = {
  v: 1,
  alg: 'A256GCM',
  keyId: 'nope',
  iv: 'aaaa',
  authTag: 'aaaa',
  ciphertext: 'aaaa',
}

type Doc = Record<string, unknown>
const tables = new Map<string, Doc[]>()
const logs: { event: string; properties: unknown }[] = []

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, want]) => {
    if (key === '$or') return (want as Doc[]).some((one) => matches(doc, one))
    const value = doc[key]

    if (want && typeof want === 'object') {
      if ('$in' in want) {
        return (want.$in as unknown[]).some((item) => String(item) === String(value))
      }
      if ('$ne' in want) return value !== want.$ne
    }

    return String(value) === String(want)
  })
}

function collection(name: string) {
  const rows = () => {
    const found = tables.get(name) ?? []

    tables.set(name, found)

    return found
  }

  return {
    findOne: async (filter: Doc) => rows().find((doc) => matches(doc, filter)) ?? null,
    find: (filter: Doc) => ({
      toArray: async () => rows().filter((doc) => matches(doc, filter)),
    }),
  }
}

useDb({ db: () => ({ collection }) })
useObservability({
  logEvent: (_level, event, properties) => {
    logs.push({ event, properties })
  },
  logError: () => {},
})
useCredentialListing({
  listSelectedCredentials: async () => [],
})

const allowPrivateHosts = config.byos.outbound.allowPrivateHosts

function stored(overrides: Partial<TeamMcpServer> & Pick<TeamMcpServer, '_id'>): TeamMcpServer {
  return {
    teamId: 'team-1',
    name: 'Homelab',
    url: 'https://1.1.1.1/mcp',
    headers: [{ name: 'Authorization', value: encryptCustomMcpSecret(SECRET) }],
    createdBy: 'admin-1',
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  }
}

const open = async () => {}

beforeEach(() => {
  tables.clear()
  logs.length = 0
  config.byos.outbound.allowPrivateHosts = false
})

describe('assembleConversationMcpServers', () => {
  test('includes a selected server with decrypted headers and leaves the unselected one unread', async () => {
    const chosen = stored({ _id: new ObjectId(), name: 'Homelab' })
    const skipped = stored({
      _id: new ObjectId(),
      name: 'Other',
      headers: [{ name: 'Authorization', value: BROKEN }],
    })
    const built = await assembleConversationMcpServers({
      selectedIds: [chosen._id.toHexString()],
      servers: [chosen, skipped],
      agentRuntime: 'codex',
      checkEgress: open,
      log: (fields) => logs.push({ event: 'assemble', properties: fields }),
    })

    expect(built.servers).toEqual([
      {
        name: 'Homelab',
        type: 'http',
        url: chosen.url,
        headers: [{ name: 'Authorization', value: SECRET }],
      },
    ])
    expect(built.notices).toEqual([])
    expect(JSON.stringify(built.notices)).not.toContain(SECRET)
    expect(JSON.stringify(logs)).not.toContain(SECRET)
    expect(JSON.stringify(customMcpLogFields(built.servers, built.notices))).not.toContain(SECRET)
  })

  test('omits a server the outbound policy refuses, without the header value', async () => {
    const chosen = stored({ _id: new ObjectId(), url: 'https://127.0.0.1/mcp' })
    const built = await assembleConversationMcpServers({
      selectedIds: [chosen._id.toHexString()],
      servers: [chosen],
      agentRuntime: 'codex',
    })

    expect(built.servers).toEqual([])
    expect(built.notices.join('\n')).toContain('not added')
    expect(built.notices.join('\n')).not.toContain(SECRET)
  })

  test('a large Antigravity declaration is a notice, not a silent drop', async () => {
    const chosen = stored({ _id: new ObjectId(), name: 'Huge' })
    const listed: string[] = []
    const built = await assembleConversationMcpServers({
      selectedIds: [chosen._id.toHexString()],
      servers: [chosen],
      agentRuntime: 'antigravity',
      reservedBytes: 20_000,
      checkEgress: open,
      listDeclaration: async () => {
        listed.push('listed')

        return {
          tools: [
            {
              name: 'huge',
              description: SECRET,
              inputSchema: { blob: 'x'.repeat(40_000) },
            },
          ],
          instructions: SECRET,
        }
      },
    })

    expect(listed).toEqual(['listed'])
    expect(built.servers).toEqual([])
    expect(built.notices[0]).toContain('32768-byte')
    expect(built.notices[0]).toContain('drop other tools')
    expect(built.notices.join('\n')).not.toContain(SECRET)
  })

  test('a small Antigravity declaration is included', async () => {
    const chosen = stored({ _id: new ObjectId(), name: 'Tiny' })
    const built = await assembleConversationMcpServers({
      selectedIds: [chosen._id.toHexString()],
      servers: [chosen],
      agentRuntime: 'antigravity',
      reservedBytes: 1_000,
      checkEgress: open,
      listDeclaration: async () => ({
        tools: [{ name: 'ping', description: 'ok' }],
        instructions: '',
      }),
    })

    expect(built.servers.map((server) => server.name)).toEqual(['Tiny'])
    expect(built.notices).toEqual([])
  })

  test('other runtimes are not size-probed', async () => {
    const chosen = stored({ _id: new ObjectId() })
    const built = await assembleConversationMcpServers({
      selectedIds: [chosen._id.toHexString()],
      servers: [chosen],
      agentRuntime: 'codex',
      checkEgress: open,
      listDeclaration: () => {
        throw new Error('must not list')
      },
    })

    expect(built.servers).toHaveLength(1)
    expect(built.notices).toEqual([])
  })

  test('an unread Antigravity tool list is left out instead of attached blind', async () => {
    const chosen = stored({ _id: new ObjectId(), name: 'Down' })
    const built = await assembleConversationMcpServers({
      selectedIds: [chosen._id.toHexString()],
      servers: [chosen],
      agentRuntime: 'antigravity',
      reservedBytes: 1_000,
      checkEgress: open,
      listDeclaration: async () => {
        throw new Error(`dial failed ${SECRET}`)
      },
    })

    expect(built.servers).toEqual([])
    expect(built.notices[0]).toContain('could not be read')
    expect(built.notices.join('\n')).not.toContain(SECRET)
  })
})

describe('selectedConversationMcpServers', () => {
  test('a conversation gets only its selected server, and a task uses its parent', async () => {
    const chosen = stored({ _id: new ObjectId(), name: 'Homelab' })
    const unselected = stored({
      _id: new ObjectId(),
      name: 'Spare',
      headers: [{ name: 'X-Token', value: encryptCustomMcpSecret(UNSELECTED) }],
    })
    const foreign = stored({
      _id: new ObjectId(),
      teamId: 'team-2',
      name: 'Foreign',
      headers: [{ name: 'Authorization', value: encryptCustomMcpSecret(OTHER_TEAM) }],
    })

    tables.set('team_mcp_servers', [chosen, unselected, foreign])
    tables.set('agent_conversations', [
      {
        sessionId: 'conv-1',
        userId: 'owner',
        teamId: 'team-1',
        agentRuntime: 'codex',
        credentialAccess: {
          mcpServerIds: [chosen._id.toHexString(), foreign._id.toHexString()],
        },
      },
      {
        sessionId: 'task-1',
        userId: 'owner',
        teamId: 'team-1',
        parentSessionId: 'conv-1',
        credentialAccess: { mcpServerIds: [] },
      },
    ])

    const direct = await selectedConversationMcpServers({
      conversationId: 'conv-1',
      teamId: 'team-1',
      agentRuntime: 'codex',
    })
    const task = await selectedConversationMcpServers({
      conversationId: 'task-1',
      teamId: 'team-1',
      agentRuntime: 'codex',
    })

    expect(direct.servers.map((server) => server.name)).toEqual(['Homelab'])
    expect(task.servers.map((server) => server.name)).toEqual(['Homelab'])
    expect(direct.servers[0]?.headers).toEqual([{ name: 'Authorization', value: SECRET }])
    expect(JSON.stringify(direct)).not.toContain(UNSELECTED)
    expect(JSON.stringify(direct)).not.toContain(OTHER_TEAM)
    expect(JSON.stringify(task)).not.toContain(UNSELECTED)
    expect(direct.notices.join('\n')).toContain('not registered')
    expect(direct.notices.join('\n')).not.toContain(SECRET)
    expect(JSON.stringify(logs)).not.toContain(SECRET)
    expect(JSON.stringify(logs)).not.toContain(UNSELECTED)
    expect(JSON.stringify(logs)).not.toContain(OTHER_TEAM)
  })

  test('previewSessionAccess appends the selected server beside the Nuphos servers', async () => {
    const chosen = stored({ _id: new ObjectId(), name: 'Homelab' })

    tables.set('team_mcp_servers', [chosen])
    tables.set('agent_conversations', [
      {
        sessionId: 'conv-1',
        userId: 'owner',
        teamId: 'team-1',
        credentialAccess: { mcpServerIds: [chosen._id.toHexString()] },
      },
    ])

    const access = await previewSessionAccess('conv-1', 'team-1', 'owner', 'owner', {
      backendUrl: 'https://backend.example',
      agentRuntime: 'codex',
    })

    expect(access.mcpServers.map((server) => server.name)).toEqual([
      'nuphos-credentials',
      'nuphos-tools',
      'Homelab',
    ])
    expect(access.mcpServers[2]?.headers).toEqual([{ name: 'Authorization', value: SECRET }])
    expect(access.notices).toEqual([])
    expect(JSON.stringify(customMcpLogFields(access.mcpServers, access.notices))).not.toContain(
      SECRET,
    )
    expect(appendMcpServerNotices('Be brief.', [])).toBe('Be brief.')
    expect(appendMcpServerNotices('Be brief.', ['Homelab was not added: too big'])).toContain(
      'Homelab was not added: too big',
    )
  })
})

describe('listRemoteMcpDeclaration', () => {
  test('reads tools and does not put the response body into an error', async () => {
    const seen: Record<string, string>[] = []
    const post = async (
      _url: string,
      headers: Record<string, string>,
      body: unknown,
    ): Promise<{
      status: number
      contentType: string
      text: string
      sessionId?: string
    }> => {
      seen.push(headers)
      const method = (body as { method?: string }).method

      if (method === 'initialize') {
        return {
          status: 200,
          contentType: 'application/json',
          sessionId: 'sess',
          text: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: { instructions: 'be brief' },
          }),
        }
      }
      if (method === 'tools/list') {
        return {
          status: 200,
          contentType: 'text/event-stream',
          text: `data: ${JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            result: {
              tools: [{ name: 'ping', description: 'ok', inputSchema: { type: 'object' } }],
            },
          })}\n\n`,
        }
      }

      return { status: 202, contentType: '', text: '' }
    }
    const declared = await listRemoteMcpDeclaration(
      'https://1.1.1.1/mcp',
      [{ name: 'Authorization', value: SECRET }],
      post,
    )

    expect(declared.instructions).toBe('be brief')
    expect(declared.tools).toEqual([
      { name: 'ping', description: 'ok', inputSchema: { type: 'object' } },
    ])
    expect(seen[0]?.Authorization).toBe(SECRET)
    expect(seen[2]?.['mcp-session-id']).toBe('sess')
    await expect(
      listRemoteMcpDeclaration('https://1.1.1.1/mcp', [], async () => ({
        status: 500,
        contentType: 'application/json',
        text: SECRET,
      })),
    ).rejects.toThrow('MCP tool list failed')
    expect(toolsOf(mcpMessageFromHttp('application/json', '{"result":{"tools":[]}}'))).toEqual([])
  })
})

afterAll(() => {
  config.byos.outbound.allowPrivateHosts = allowPrivateHosts
})
