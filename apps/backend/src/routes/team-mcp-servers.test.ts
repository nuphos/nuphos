import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { config } from '@/config'
import { decryptCustomMcpSecret } from '@/lib/byos/secrets'
import { errorHandler } from '@/lib/errors'
import { setupTeamMcpServerIndexes } from '@/lib/mcp/team-servers'
import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'

import { teamMcpServersRoutes } from './team-mcp-servers'

import type { NuphosTeamRole } from '@/lib/identity/types'
import type { TeamMcpServer } from '@/lib/mcp/team-servers'

process.env.CUSTOM_MCP_BYOK_ENCRYPTION_KEY = 'b'.repeat(64)

type Doc = Record<string, unknown>
const tables = new Map<string, Doc[]>()
const createdIndexes: { spec: Doc; options: Doc }[] = []
const table = (name: string) => {
  const rows = tables.get(name) ?? []

  tables.set(name, rows)

  return rows
}
const matches = (doc: Doc, filter: Doc) =>
  Object.entries(filter).every(([field, want]) => String(doc[field]) === String(want))

function collection(name: string) {
  const rows = table(name)

  return {
    find: (filter: Doc) => {
      const found = rows.filter((row) => matches(row, filter))
      const cursor = {
        sort: (spec: Doc) => {
          const [field, direction] = Object.entries(spec)[0] ?? []

          if (field) {
            found.sort((left, right) => {
              if (left[field] === right[field]) return 0
              const order = String(left[field]) > String(right[field]) ? 1 : -1

              return direction === -1 ? -order : order
            })
          }

          return cursor
        },
        toArray: () => found,
      }

      return cursor
    },
    countDocuments: (filter: Doc) => rows.filter((row) => matches(row, filter)).length,
    insertOne: (doc: Doc) => {
      rows.push(doc)
    },
    findOne: (filter: Doc) => rows.find((row) => matches(row, filter)) ?? null,
    findOneAndUpdate: (filter: Doc, update: { $set: Doc }) => {
      const row = rows.find((candidate) => matches(candidate, filter))

      if (!row) return null
      Object.assign(row, update.$set)

      return row
    },
    deleteOne: (filter: Doc) => {
      const index = rows.findIndex((row) => matches(row, filter))

      if (index >= 0) rows.splice(index, 1)
    },
    createIndex: async (spec: Doc, options: Doc) => {
      createdIndexes.push({ spec, options })
    },
  }
}

useDb({ db: () => ({ collection }) })

let role: NuphosTeamRole = 'ADMINISTRATOR'

useIdentity({
  getTeamMembership: () => ({ role, team: {} }),
})
const app = new Hono()

app.onError(errorHandler)
app.use('*', async (c, next) => {
  c.set('teamId' as never, 'team-1')
  c.set('userId' as never, 'admin-1')
  c.set('teamRole' as never, role)
  await next()
})
app.route('/mcp-servers', teamMcpServersRoutes)

const call = (method: string, path: string, body?: unknown) =>
  app.request(`/mcp-servers${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

const SECRET = 'Bearer s3cret-value'
// eslint-disable-next-line sonarjs/no-clear-text-protocols -- fixture URL, never requested
const PRIVATE_HTTP = 'http://10.1.2.3/mcp'
const PUBLIC_HTTP = 'http://mcp.example.com/mcp'
const allowPrivateHosts = config.byos.outbound.allowPrivateHosts
const valid = {
  name: 'Homelab',
  url: 'https://mcp.example.com/mcp',
  headers: [{ name: 'Authorization', value: SECRET }],
}

const stored = () => table('team_mcp_servers')[0] as unknown as TeamMcpServer
const bodyOf = async (res: Response) => JSON.stringify(await res.json())

async function create(body: unknown = valid): Promise<{ id: string; raw: string }> {
  const res = await call('POST', '', body)
  const raw = await bodyOf(res)

  expect(res.status).toBe(201)

  return { id: (JSON.parse(raw) as { mcpServer: { id: string } }).mcpServer.id, raw }
}

beforeEach(() => {
  tables.clear()
  createdIndexes.length = 0
  role = 'ADMINISTRATOR'
  config.byos.outbound.allowPrivateHosts = false
})

afterAll(() => {
  config.byos.outbound.allowPrivateHosts = allowPrivateHosts
})

describe('team MCP server routes', () => {
  test('only administrators can manage MCP servers', async () => {
    for (const denied of ['VIEWER', 'EDITOR'] as const) {
      role = denied
      expect((await call('GET', '')).status).toBe(403)
      expect((await call('POST', '', valid)).status).toBe(403)
      expect((await call('PATCH', '/abc', { name: 'x' })).status).toBe(403)
      expect((await call('DELETE', '/abc')).status).toBe(403)
    }
    expect(table('team_mcp_servers')).toHaveLength(0)
  })

  test('creates, lists, updates and deletes a server without returning header values', async () => {
    const created = await create()

    expect(stored().createdBy).toBe('admin-1')
    expect(stored().teamId).toBe('team-1')
    expect(JSON.stringify(stored().headers)).not.toContain(SECRET)
    expect(decryptCustomMcpSecret(stored().headers[0]!.value)).toBe(SECRET)
    expect(created.raw).not.toContain(SECRET)
    expect(created.raw).not.toContain('ciphertext')
    expect(JSON.parse(created.raw)).toMatchObject({
      mcpServer: { name: 'Homelab', url: valid.url, headers: ['Authorization'] },
    })

    const listed = await call('GET', '')
    const listedRaw = await bodyOf(listed)

    expect(listed.status).toBe(200)
    expect(JSON.parse(listedRaw)).toMatchObject({
      mcpServers: [{ id: created.id, headers: ['Authorization'] }],
    })
    expect(listedRaw).not.toContain(SECRET)

    const before = stored().headers[0]!.value
    const updated = await call('PATCH', `/${created.id}`, {
      name: 'Ops',
      headers: [{ name: 'authorization' }, { name: 'X-Team', value: 'ops' }],
    })
    const updatedRaw = await bodyOf(updated)

    expect(updated.status).toBe(200)
    expect(stored().headers.map((header) => header.name)).toEqual(['authorization', 'X-Team'])
    expect(stored().headers[0]!.value).toEqual(before)
    expect(decryptCustomMcpSecret(stored().headers[1]!.value)).toBe('ops')
    expect(updatedRaw).not.toContain(SECRET)
    expect(updatedRaw).not.toContain('ops')
    expect(JSON.parse(updatedRaw)).toMatchObject({
      mcpServer: { name: 'Ops', headers: ['authorization', 'X-Team'] },
    })

    const replaced = await call('PATCH', `/${created.id}`, {
      headers: [{ name: 'Authorization', value: 'Bearer rotated-secret' }],
    })
    const replacedRaw = await bodyOf(replaced)

    expect(replaced.status).toBe(200)
    expect(decryptCustomMcpSecret(stored().headers[0]!.value)).toBe('Bearer rotated-secret')
    expect(replacedRaw).not.toContain('rotated-secret')
    expect(replacedRaw).not.toContain(SECRET)

    expect((await call('DELETE', `/${created.id}`)).status).toBe(200)
    expect(table('team_mcp_servers')).toHaveLength(0)
    expect((await call('DELETE', `/${created.id}`)).status).toBe(404)
    expect((await call('GET', '')).status).toBe(200)
    expect(await bodyOf(await call('GET', ''))).toBe('{"mcpServers":[]}')
  })

  test('a header omitted from an update must already be stored', async () => {
    const { id } = await create()
    const missing = await call('PATCH', `/${id}`, { headers: [{ name: 'X-New' }] })
    const raw = await bodyOf(missing)

    expect(missing.status).toBe(400)
    expect(raw).not.toContain(SECRET)
    expect(stored().headers).toHaveLength(1)
  })

  test.each([
    ['a private address', 'https://127.0.0.1/mcp'],
    ['a lan address', PRIVATE_HTTP],
    ['localhost', 'https://localhost/mcp'],
    ['an ipv6 loopback', 'https://[::1]/mcp'],
    ['a blocked service address', 'https://34.118.230.5/mcp'],
    ['a non-http URL', 'file:///tmp/mcp'],
    ['embedded credentials', 'https://user:s3cret-value@mcp.example.com/mcp'],
    ['a public http URL', PUBLIC_HTTP],
    ['a query token', 'https://mcp.example.com/mcp?access_token=query-token'],
    ['a fragment token', 'https://mcp.example.com/mcp#query-token'],
  ])('rejects %s', async (_label, url) => {
    const res = await call('POST', '', { ...valid, url })
    const raw = await bodyOf(res)

    expect(res.status).toBe(400)
    expect(raw).not.toContain(SECRET)
    expect(raw).not.toContain('s3cret-value')
    expect(raw).not.toContain('query-token')
    expect(table('team_mcp_servers')).toHaveLength(0)
  })

  test('accepts a public URL and a private URL only when the deployment allows it', async () => {
    const created = await create()

    expect(created.raw).not.toContain(SECRET)
    const blockedUpdate = await call('PATCH', `/${created.id}`, { url: 'https://192.168.1.9/mcp' })

    expect(blockedUpdate.status).toBe(400)
    expect(await bodyOf(blockedUpdate)).not.toContain(SECRET)
    expect(stored().url).toBe(valid.url)

    config.byos.outbound.allowPrivateHosts = true
    const publicHttp = await call('POST', '', { ...valid, name: 'Cleartext', url: PUBLIC_HTTP })

    expect(publicHttp.status).toBe(400)
    expect(await bodyOf(publicHttp)).not.toContain(SECRET)
    expect(table('team_mcp_servers')).toHaveLength(1)

    const allowed = await call('POST', '', {
      ...valid,
      name: 'Tailnet',
      url: PRIVATE_HTTP,
    })
    const raw = await bodyOf(allowed)

    expect(allowed.status).toBe(201)
    expect(JSON.parse(raw)).toMatchObject({ mcpServer: { url: PRIVATE_HTTP } })
    expect(raw).not.toContain(SECRET)
    expect(table('team_mcp_servers')).toHaveLength(2)
  })

  test.each([
    ['a reserved header', { headers: [{ name: 'Content-Type', value: 'application/json' }] }],
    ['a header with a newline', { headers: [{ name: 'X-Key', value: 'a\r\nb' }] }],
    [
      'a duplicate header',
      {
        headers: [
          { name: 'X-Key', value: 'a' },
          { name: 'x-key', value: 'b' },
        ],
      },
    ],
  ])('rejects %s', async (_label, patch) => {
    const res = await call('POST', '', { ...valid, ...patch })

    expect(res.status).toBe(400)
    expect(await bodyOf(res)).not.toContain(SECRET)
  })

  test('an empty header list clears stored headers', async () => {
    const { id } = await create()
    const res = await call('PATCH', `/${id}`, { headers: [] })
    const raw = await bodyOf(res)

    expect(res.status).toBe(200)
    expect(stored().headers).toEqual([])
    expect(JSON.parse(raw)).toMatchObject({ mcpServer: { headers: [] } })
    expect(raw).not.toContain(SECRET)
  })

  test('a team can store at most 20 servers', async () => {
    for (let index = 0; index < 20; index += 1) {
      const res = await call('POST', '', { ...valid, name: `server-${String(index)}` })

      expect(res.status).toBe(201)
      expect(await bodyOf(res)).not.toContain(SECRET)
    }
    const extra = await call('POST', '', { ...valid, name: 'overflow' })
    const raw = await bodyOf(extra)

    expect(extra.status).toBe(409)
    expect(raw).not.toContain(SECRET)
    expect(table('team_mcp_servers')).toHaveLength(20)
  })

  test.each(['nuphos-credentials', 'Nuphos-Tools', 'NUPHOS-CREDENTIALS'])(
    'rejects the built-in server name %s',
    async (name) => {
      const created = await call('POST', '', { ...valid, name })
      const raw = await bodyOf(created)

      expect(created.status).toBe(400)
      expect(raw).toContain('reserved')
      expect(raw).not.toContain(SECRET)
      expect(table('team_mcp_servers')).toHaveLength(0)

      const { id } = await create()
      const renamed = await call('PATCH', `/${id}`, { name })

      expect(renamed.status).toBe(400)
      expect(await bodyOf(renamed)).not.toContain(SECRET)
      expect(stored().name).toBe('Homelab')
    },
  )

  test('a server from another team is invisible', async () => {
    const { id } = await create()

    table('team_mcp_servers').push({
      ...(stored() as unknown as Doc),
      _id: 'other',
      teamId: 'team-2',
      name: 'Elsewhere',
    })
    const listed = JSON.parse(await bodyOf(await call('GET', ''))) as {
      mcpServers: { name: string }[]
    }

    expect(listed.mcpServers.map((server) => server.name)).toEqual(['Homelab'])
    expect((await call('DELETE', `/${id}`)).status).toBe(200)
    expect(table('team_mcp_servers')).toHaveLength(1)
    expect(table('team_mcp_servers')[0]).toMatchObject({ teamId: 'team-2' })
  })

  test('changing url on PATCH drops stored headers or requires new values', async () => {
    const { id } = await create()
    const originalHeader = stored().headers[0]!.value

    // Same URL keeps stored headers when omitted or sent without a value.
    const sameUrl = await call('PATCH', `/${id}`, {
      url: valid.url,
      headers: [{ name: 'Authorization' }],
    })

    expect(sameUrl.status).toBe(200)
    expect(stored().headers[0]!.value).toEqual(originalHeader)

    // New URL + header without a value is rejected and leaves stored server intact.
    const missingValue = await call('PATCH', `/${id}`, {
      url: 'https://other.example.com/mcp',
      headers: [{ name: 'Authorization' }],
    })

    expect(missingValue.status).toBe(400)
    expect(await bodyOf(missingValue)).not.toContain(SECRET)
    expect(stored().url).toBe(valid.url)
    expect(stored().headers[0]!.value).toEqual(originalHeader)

    // New URL without headers drops stored headers so secrets are never sent to a new host.
    const dropped = await call('PATCH', `/${id}`, {
      url: 'https://other.example.com/mcp',
    })

    expect(dropped.status).toBe(200)
    expect(stored().url).toBe('https://other.example.com/mcp')
    expect(stored().headers).toEqual([])

    // New URL with explicit new header value stores the new secret.
    const reentered = await call('PATCH', `/${id}`, {
      url: 'https://third.example.com/mcp',
      headers: [{ name: 'Authorization', value: 'Bearer fresh-secret' }],
    })

    expect(reentered.status).toBe(200)
    expect(stored().url).toBe('https://third.example.com/mcp')
    expect(decryptCustomMcpSecret(stored().headers[0]!.value)).toBe('Bearer fresh-secret')
  })

  test.each(['my server', 'a.b', 'a/b', '-leading-dash', '_leading_under', 'foo:bar'])(
    'rejects invalid server name %s',
    async (name) => {
      const res = await call('POST', '', { ...valid, name })

      expect(res.status).toBe(400)
      expect(await bodyOf(res)).not.toContain(SECRET)
      expect(table('team_mcp_servers')).toHaveLength(0)
    },
  )

  test('enforces case-insensitive unique server names per team and registers unique index', async () => {
    await setupTeamMcpServerIndexes()
    expect(createdIndexes).toContainEqual({
      spec: { teamId: 1, name: 1 },
      options: {
        name: 'team_mcp_servers_team_name_unique',
        unique: true,
        collation: { locale: 'en', strength: 2 },
      },
    })

    const first = await create({ ...valid, name: 'Homelab' })
    const dupCreate = await call('POST', '', { ...valid, name: 'homelab' })

    expect(dupCreate.status).toBe(409)
    expect(await bodyOf(dupCreate)).toContain('mcp_server_name_taken')

    // Another team may use the same name.
    table('team_mcp_servers').push({
      ...(stored() as unknown as Doc),
      _id: 'other-team-doc',
      teamId: 'team-2',
      name: 'Ops',
    })
    const second = await create({ ...valid, name: 'Ops' })

    // Renaming second to collide with first (different case) fails with 409.
    const dupPatch = await call('PATCH', `/${second.id}`, { name: 'HOMELAB' })

    expect(dupPatch.status).toBe(409)

    // Renaming first to a different casing of its own name succeeds.
    const selfCase = await call('PATCH', `/${first.id}`, { name: 'homelab' })

    expect(selfCase.status).toBe(200)
  })
})
