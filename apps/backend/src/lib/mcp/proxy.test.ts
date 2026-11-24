import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { config } from '@/config'
import { encryptCustomMcpSecret } from '@/lib/byos/secrets'
import { errorHandler } from '@/lib/errors'
import { OutboundBlockedError } from '@/lib/net/safe-outbound'
import { useDb } from '@/lib/test/doubles/db'

import { createTeamMcpProxyHandler } from './proxy'

import type { EncryptedSecret } from '@/lib/byos/secrets'
import type { TeamMcpServer } from './team-servers'

process.env.CUSTOM_MCP_BYOK_ENCRYPTION_KEY = 'b'.repeat(64)

const SECRET = 'Bearer upstream-s3cret-value'
const BROKEN: EncryptedSecret = {
  v: 1,
  alg: 'A256GCM',
  keyId: 'nope',
  iv: 'aaaa',
  authTag: 'aaaa',
  ciphertext: 'aaaa',
}

type Doc = Record<string, unknown>
const rows: Doc[] = []

useDb({
  db: () => ({
    collection: () => ({
      findOne: async (filter: Doc) =>
        rows.find((doc) =>
          Object.entries(filter).every(([field, want]) => String(doc[field]) === String(want)),
        ) ?? null,
    }),
  }),
})

const allowPrivateHosts = config.byos.outbound.allowPrivateHosts

function serverDoc(overrides: Partial<TeamMcpServer> = {}): TeamMcpServer {
  return {
    _id: new ObjectId(),
    teamId: 'team-1',
    name: 'homelab',
    url: 'https://mcp.example.com/mcp',
    headers: [{ name: 'Authorization', value: encryptCustomMcpSecret(SECRET) }],
    createdBy: 'admin-1',
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  }
}

function makeApp(options: {
  selectedIds: string[]
  fetch: Parameters<typeof createTeamMcpProxyHandler>[0]['fetch']
}) {
  const app = new Hono()

  app.onError(errorHandler)
  app.use('*', async (c, next) => {
    c.set('teamId' as never, 'team-1')
    c.set('userId' as never, 'admin-1')
    c.set('agent' as never, { userId: 'admin-1', sessionId: 'conv-1' })
    await next()
  })
  const handler = createTeamMcpProxyHandler({
    fetch: options.fetch,
    getAccess: async () =>
      ({
        mcpServerIds: options.selectedIds,
      }) as never,
  })

  app.post('/mcp-servers/:serverId', handler)
  app.get('/mcp-servers/:serverId', handler)
  app.delete('/mcp-servers/:serverId', handler)

  return app
}

beforeEach(() => {
  rows.length = 0
  config.byos.outbound.allowPrivateHosts = false
})

afterAll(() => {
  config.byos.outbound.allowPrivateHosts = allowPrivateHosts
})

describe('createTeamMcpProxyHandler', () => {
  test('forwards POST with decrypted headers via pinnedFetch and streams response', async () => {
    const server = serverDoc()

    rows.push(server as unknown as Doc)
    const calls: { url: string; method?: string; headers: Headers; body?: string }[] = []
    const app = makeApp({
      selectedIds: [server._id.toHexString()],
      fetch: async (url, init = {}) => {
        const headers = new Headers(init.headers)
        const body =
          init.body instanceof Uint8Array
            ? Buffer.from(init.body).toString('utf8')
            : (init.body ?? undefined)

        calls.push({ url, method: init.method, headers, body })

        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true } }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'mcp-session-id': 'sess-123',
          },
        })
      },
    })

    const res = await app.request(`/mcp-servers/${server._id.toHexString()}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: 'Bearer conversation-token-must-not-override',
        'mcp-session-id': 'sess-in',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call' }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('mcp-session-id')).toBe('sess-123')
    expect(await res.json()).toEqual({ jsonrpc: '2.0', id: 1, result: { ok: true } })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(server.url)
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.headers.get('authorization')).toBe(SECRET)
    expect(calls[0]?.headers.get('mcp-session-id')).toBe('sess-in')
  })

  test('refuses unselected server and foreign-team server without calling upstream', async () => {
    const own = serverDoc()
    const foreign = serverDoc({ teamId: 'team-2' })

    rows.push(own as unknown as Doc, foreign as unknown as Doc)
    let called = false
    const app = makeApp({
      selectedIds: [foreign._id.toHexString()],
      fetch: async () => {
        called = true

        return new Response('ok')
      },
    })

    const unselectedRes = await app.request(`/mcp-servers/${own._id.toHexString()}`, {
      method: 'POST',
      body: '{}',
    })

    expect(unselectedRes.status).toBe(403)
    expect(await unselectedRes.text()).not.toContain(SECRET)

    const foreignRes = await app.request(`/mcp-servers/${foreign._id.toHexString()}`, {
      method: 'POST',
      body: '{}',
    })

    expect(foreignRes.status).toBe(404)
    expect(await foreignRes.text()).not.toContain(SECRET)
    expect(called).toBe(false)
  })

  test('blocks DNS rebinding (OutboundBlockedError at call time) without leaking secrets', async () => {
    const server = serverDoc()

    rows.push(server as unknown as Doc)
    const app = makeApp({
      selectedIds: [server._id.toHexString()],
      fetch: async () => {
        throw new OutboundBlockedError(
          'Host mcp.example.com resolves to a private / loopback / reserved IP',
          400,
        )
      },
    })

    const res = await app.request(`/mcp-servers/${server._id.toHexString()}`, {
      method: 'POST',
      body: '{}',
    })
    const text = await res.text()

    expect(res.status).toBe(400)
    expect(text).toContain('outbound_blocked')
    expect(text).not.toContain(SECRET)
  })

  test('refuses upstream 3xx redirects without following or leaking Location / secrets', async () => {
    const server = serverDoc()

    rows.push(server as unknown as Doc)
    const app = makeApp({
      selectedIds: [server._id.toHexString()],
      fetch: async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'http://169.254.169.254/latest/meta-data' },
        }),
    })

    const res = await app.request(`/mcp-servers/${server._id.toHexString()}`, {
      method: 'POST',
      body: '{}',
    })
    const text = await res.text()

    // errorHandler maps upstream 502 AppErrors to 503 so reverse proxies preserve the JSON body.
    expect(res.status).toBe(503)
    expect(res.headers.get('location')).toBeNull()
    expect(text).toContain('upstream_redirect_blocked')
    expect(text).not.toContain('169.254.169.254')
    expect(text).not.toContain(SECRET)
  })

  test('returns 503 when stored headers cannot be decrypted', async () => {
    const server = serverDoc({ headers: [{ name: 'Authorization', value: BROKEN }] })

    rows.push(server as unknown as Doc)
    const app = makeApp({
      selectedIds: [server._id.toHexString()],
      fetch: async () => {
        throw new Error('must not dial')
      },
    })

    const res = await app.request(`/mcp-servers/${server._id.toHexString()}`, {
      method: 'POST',
      body: '{}',
    })

    expect(res.status).toBe(503)
    expect(await res.text()).toContain('mcp_headers_unavailable')
  })
})
