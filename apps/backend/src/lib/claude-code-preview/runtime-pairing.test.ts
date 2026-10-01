import { randomBytes } from 'node:crypto'

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { config } from '@/config'
import { AppError } from '@/lib/errors'
import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'

import type { ClaudeCodeRuntimeDoc } from './runtime-registry'
import type { NuphosTeam, NuphosUser } from '@/lib/identity/types'
import type { TeamAuthVariables } from '@/middleware/auth'

const previousKey = config.claudeCodePreview.tokenEncryptionKey

config.claudeCodePreview.tokenEncryptionKey = randomBytes(32).toString('base64')
afterAll(() => {
  config.claudeCodePreview.tokenEncryptionKey = previousKey
})
useIdentity({
  getTeamsByIds: (ids: string[]) =>
    Promise.resolve(ids.map((id) => ({ id, name: 'Platform' }) as NuphosTeam)),
  getNuphosUserById: () => Promise.resolve({ name: 'Ada Admin' } as NuphosUser),
})

let docs: ClaudeCodeRuntimeDoc[] = []
let insertFails = false
const field = (doc: ClaudeCodeRuntimeDoc, name: string) =>
  (doc as unknown as Record<string, unknown>)[name]
const matches = (doc: ClaudeCodeRuntimeDoc, query: Record<string, unknown>) =>
  Object.entries(query).every(([name, value]) =>
    value && typeof value === 'object' && '$exists' in value
      ? (field(doc, name) !== undefined) === value.$exists
      : field(doc, name) === value,
  )

useDb({
  db: () => ({
    collection: () => ({
      find: (query: Record<string, unknown>) => ({
        sort: () => ({
          toArray: () => Promise.resolve(docs.filter((doc) => matches(doc, query))),
        }),
      }),
      findOne: (query: Record<string, unknown>) =>
        Promise.resolve(docs.find((doc) => matches(doc, query)) ?? null),
      insertOne: (doc: ClaudeCodeRuntimeDoc) => {
        if (insertFails) return Promise.reject(new Error('insert failed'))
        docs.push(doc)

        return Promise.resolve({ insertedId: doc._id })
      },
      updateOne: (
        query: Record<string, unknown>,
        update: { $set?: Partial<ClaudeCodeRuntimeDoc>; $unset?: Record<string, unknown> },
      ) => {
        const doc = docs.find((item) => matches(item, query))

        if (doc) {
          Object.assign(doc, update.$set)
          for (const name of Object.keys(update.$unset ?? {}))
            delete (doc as unknown as Record<string, unknown>)[name]
        }

        return Promise.resolve({ matchedCount: doc ? 1 : 0, modifiedCount: doc ? 1 : 0 })
      },
      deleteOne: (query: Record<string, unknown>) => {
        const index = docs.findIndex((doc) => matches(doc, query))

        if (index !== -1) docs.splice(index, 1)

        return Promise.resolve({ deletedCount: index === -1 ? 0 : 1 })
      },
    }),
  }),
})

const { registerExternalRuntimeRoute } = await import('@/routes/teams/claude-code-runtimes')
const { removeTeamRuntime, listTeamRuntimes } = await import('./runtime-registry')
const { pairTeamRuntime, pairedBindingRevoked } = await import('./runtime-pairing')
const { normalizePairingRuntimeUrl, exchangePairingCode } = await import('./runtime-pairing-client')
const { storedAuthKey } = await import('./runtime-registry-credentials')

const CODE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

type Call = { url: string; method: string; body?: unknown; authorization?: string }
let calls: Call[] = []
let respond: (call: Call) => Response
const originalFetch = globalThis.fetch
const publicBackendUrl = config.agent.publicBackendUrl

function exchangeResponse(overrides: Record<string, unknown> = {}) {
  return Response.json({
    bindingId: 'b1',
    transportKey: `nrt_b1_${'t'.repeat(43)}`,
    controlKey: `nrc_b1_${'c'.repeat(43)}`,
    runtimeInstanceId: 'instance-1',
    provider: 'claude-code',
    pendingUntil: '2026-09-25T00:15:00Z',
    ...overrides,
  })
}

function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  const call: Call = {
    url: input instanceof Request ? input.url : input.toString(),
    method: init?.method ?? 'GET',
    ...(typeof init?.body === 'string' ? { body: JSON.parse(init.body) as unknown } : {}),
    ...(headers.get('authorization') ? { authorization: headers.get('authorization')! } : {}),
  }

  calls.push(call)

  return Promise.resolve(respond(call))
}

function app(role: TeamAuthVariables['teamRole'] = 'ADMINISTRATOR') {
  const server = new Hono<{ Variables: TeamAuthVariables }>()

  server.use('*', async (c, next) => {
    c.set('teamId', 'team-1')
    c.set('userId', 'user-1')
    c.set('teamRole', role)
    await next()
  })
  server.onError((error, c) =>
    error instanceof AppError
      ? c.json({ code: error.code, details: error.details }, error.status)
      : c.json({ code: 'unexpected' }, 500),
  )
  registerExternalRuntimeRoute(server)

  return server
}

function pair(body: Record<string, unknown>, role?: TeamAuthVariables['teamRole']) {
  return app(role).request('/agent-runtimes/pair', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://agent.example.com', code: CODE, ...body }),
  })
}

beforeEach(() => {
  docs = []
  calls = []
  insertFails = false
  respond = (call) =>
    call.url.endsWith('/_openab/pairing/exchange') ? exchangeResponse() : new Response(null)
  config.agent.publicBackendUrl = 'https://api.nuphos.test'
  globalThis.fetch = fakeFetch as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
  config.agent.publicBackendUrl = publicBackendUrl
})

describe('normalizePairingRuntimeUrl', () => {
  test('maps console addresses onto the ACP endpoint', () => {
    expect(normalizePairingRuntimeUrl('https://agent.example.com')).toBe(
      'wss://agent.example.com/acp',
    )
    expect(normalizePairingRuntimeUrl('wss://agent.example.com:8443/acp/')).toBe(
      'wss://agent.example.com:8443/acp',
    )
    expect(normalizePairingRuntimeUrl('ws://agent.team.svc:8080')).toBe(
      'ws://agent.team.svc:8080/acp',
    )
  })

  test('refuses plaintext to the internet, credentials in the URL and other schemes', () => {
    expect(normalizePairingRuntimeUrl('http://agent.example.com')).toBeNull()
    expect(normalizePairingRuntimeUrl('https://user:pw@agent.example.com')).toBeNull()
    expect(normalizePairingRuntimeUrl('file:///etc/passwd')).toBeNull()
  })
})

describe('POST /agent-runtimes/pair', () => {
  test('exchanges the code and stores the binding keys sealed', async () => {
    const response = await pair({ label: 'Office Mac' })

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      url: 'wss://agent.example.com/acp',
      provider: 'claude-code',
      connection: 'paired',
      label: 'Office Mac',
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      url: 'https://agent.example.com/_openab/pairing/exchange',
      method: 'POST',
      body: {
        code: CODE,
        client: {
          backendOrigin: 'https://api.nuphos.test',
          teamId: 'team-1',
          teamName: 'Platform',
          pairedBy: 'Ada Admin',
          runtimeRecordId: docs[0]?._id,
        },
      },
    })
    expect(docs[0]?.pairing).toMatchObject({
      bindingId: 'b1',
      runtimeInstanceId: 'instance-1',
      pairedByUserId: 'user-1',
    })
    expect(storedAuthKey(docs[0]?.authKeyEnvelope)).toBe(`nrt_b1_${'t'.repeat(43)}`)
    expect(storedAuthKey(docs[0]?.controlKeyEnvelope)).toBe(`nrc_b1_${'c'.repeat(43)}`)
  })

  test('is for administrators only', async () => {
    expect((await pair({}, 'EDITOR')).status).toBe(403)
    expect(calls).toHaveLength(0)
  })

  test('rejects a malformed code and a plaintext public URL without calling out', async () => {
    expect((await pair({ code: 'not-a-code' })).status).toBe(400)
    const plaintext = await pair({ url: 'http://agent.example.com' })

    expect(plaintext.status).toBe(422)
    expect(((await plaintext.json()) as { code: string }).code).toBe('invalid_runtime_url')
    expect(calls).toHaveLength(0)
  })

  test('reports an expired or used code', async () => {
    respond = () => Response.json({ error: 'expired' }, { status: 410 })
    const response = await pair({})

    expect(response.status).toBe(422)
    expect(((await response.json()) as { code: string }).code).toBe('pairing_code_rejected')
    expect(docs).toHaveLength(0)
  })

  test('does not follow a redirect', async () => {
    respond = () => new Response(null, { status: 302, headers: { location: 'http://10.0.0.1' } })
    const response = await pair({})

    expect(response.status).toBe(502)
    expect(calls).toHaveLength(1)
  })

  test('refuses a second connection to the same agent before spending the code', async () => {
    expect((await pair({})).status).toBe(201)
    calls = []
    const response = await pair({})

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      code: 'runtime_already_connected',
      details: { runtimeId: docs[0]?._id },
    })
    expect(calls).toHaveLength(0)
  })

  test('updates the existing connection in place and revokes the binding it replaces', async () => {
    await pair({})
    const runtimeId = docs[0]!._id

    respond = (call) =>
      call.url.endsWith('/_openab/pairing/exchange')
        ? exchangeResponse({
            bindingId: 'b2',
            transportKey: `nrt_b2_${'u'.repeat(43)}`,
            controlKey: `nrc_b2_${'d'.repeat(43)}`,
          })
        : new Response(null)
    calls = []
    const response = await pair({ replaceRuntimeId: runtimeId })

    expect(response.status).toBe(200)
    expect(docs).toHaveLength(1)
    expect(docs[0]?._id).toBe(runtimeId)
    expect(docs[0]?.pairing?.bindingId).toBe('b2')
    expect(storedAuthKey(docs[0]?.authKeyEnvelope)).toBe(`nrt_b2_${'u'.repeat(43)}`)
    expect(calls.map((call) => [call.url, call.authorization])).toEqual([
      ['https://agent.example.com/_openab/pairing/exchange', undefined],
      ['https://agent.example.com/_openab/bindings/self/revoke', `Bearer nrc_b1_${'c'.repeat(43)}`],
    ])
  })

  test('refuses to replace a connection with an agent of another type', async () => {
    await pair({})
    const runtimeId = docs[0]!._id

    respond = (call) =>
      call.url.endsWith('/_openab/pairing/exchange')
        ? exchangeResponse({ bindingId: 'b2', provider: 'codex' })
        : new Response(null)
    calls = []
    const response = await pair({ replaceRuntimeId: runtimeId })

    expect(response.status).toBe(409)
    expect(((await response.json()) as { code: string }).code).toBe('runtime_provider_mismatch')
    expect(docs[0]?.pairing?.bindingId).toBe('b1')
    expect(calls.at(-1)?.url).toBe('https://agent.example.com/_openab/bindings/self/revoke')
  })

  test('a replacement without a separate operator key drops the stale one', async () => {
    await pair({})
    const runtimeId = docs[0]!._id
    const shared = `nrt_b2_${'u'.repeat(43)}`

    respond = (call) =>
      call.url.endsWith('/_openab/pairing/exchange')
        ? exchangeResponse({ bindingId: 'b2', transportKey: shared, controlKey: shared })
        : new Response(null)

    expect((await pair({ replaceRuntimeId: runtimeId })).status).toBe(200)
    expect(docs[0]?.controlKeyEnvelope).toBeUndefined()
  })

  test('upgrades a password-connected row in place', async () => {
    docs.push({
      _id: 'legacy',
      teamId: 'team-1',
      url: 'wss://agent.example.com/acp',
      status: 'active',
      createdByUserId: 'user-0',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    expect((await listTeamRuntimes('team-1'))[0]?.connection).toBe('password')
    expect((await pair({})).status).toBe(409)
    expect((await pair({ replaceRuntimeId: 'legacy' })).status).toBe(200)
    expect((await listTeamRuntimes('team-1'))[0]?.connection).toBe('paired')
  })

  test('revokes the new binding when the row cannot be stored', async () => {
    insertFails = true

    expect((await pair({})).status).toBe(500)
    expect(calls.map((call) => call.url)).toEqual([
      'https://agent.example.com/_openab/pairing/exchange',
      'https://agent.example.com/_openab/bindings/self/revoke',
    ])
  })
})

describe('pairTeamRuntime', () => {
  test('falls back to probing the agent when the exchange does not name a provider', async () => {
    respond = () => exchangeResponse({ provider: undefined })
    const probed: string[] = []
    const runtime = await pairTeamRuntime({
      teamId: 'team-1',
      userId: 'user-1',
      url: 'wss://agent.example.com/acp',
      code: CODE,
      probe: (_url, authKey) => {
        probed.push(authKey)

        return Promise.resolve('codex')
      },
    })

    expect(runtime.provider).toBe('codex')
    expect(probed).toEqual([`nrt_b1_${'t'.repeat(43)}`])
  })

  test('revokes the binding when neither the exchange nor a probe names a provider', async () => {
    respond = (call) =>
      call.url.endsWith('/exchange') ? exchangeResponse({ provider: undefined }) : new Response()
    const attempt = pairTeamRuntime({
      teamId: 'team-1',
      userId: 'user-1',
      url: 'wss://agent.example.com/acp',
      code: CODE,
      probe: () => Promise.resolve(undefined),
    })

    await expect(attempt).rejects.toMatchObject({ code: 'runtime_provider_undetected' })
    expect(calls.at(-1)?.url).toBe('https://agent.example.com/_openab/bindings/self/revoke')
    expect(docs).toHaveLength(0)
  })

  test('refuses an oversized response', async () => {
    respond = () => new Response('x'.repeat(20 * 1024), { status: 200 })

    await expect(
      exchangePairingCode('wss://agent.example.com/acp', CODE, {
        backendOrigin: '',
        teamId: 't',
        teamName: '',
        pairedBy: '',
        runtimeRecordId: 'r',
      }),
    ).rejects.toMatchObject({ code: 'runtime_unreachable' })
  })
})

describe('removal and status', () => {
  test('removing a paired row revokes its binding', async () => {
    await pair({})
    calls = []

    expect(await removeTeamRuntime('team-1', docs[0]!._id)).toBe(true)
    expect(calls).toEqual([
      {
        url: 'https://agent.example.com/_openab/bindings/self/revoke',
        method: 'POST',
        authorization: `Bearer nrc_b1_${'c'.repeat(43)}`,
      },
    ])
  })

  test('a 401 from the binding self-check reads as revoked; anything else does not', async () => {
    await pair({})
    const runtimeId = docs[0]!._id

    respond = () => new Response(null, { status: 401 })
    expect(await pairedBindingRevoked('team-1', runtimeId)).toBe(true)
    respond = () => new Response(null, { status: 503 })
    expect(await pairedBindingRevoked('team-1', runtimeId)).toBe(false)
    respond = () => Response.json({ bindingId: 'b1', state: 'active' })
    expect(await pairedBindingRevoked('team-1', runtimeId)).toBe(false)
  })
})

describe('local stack addresses', () => {
  const localStack = config.localStack
  const loopback = ['ws://127.0.0.1:18180/acp', 'ws://localhost:18180/acp']

  function registerWithPassword(url: string) {
    return app().request('/agent-runtimes/external', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, authKey: 'p'.repeat(40), provider: 'claude-code' }),
    })
  }

  beforeEach(() => {
    config.agent.publicBackendUrl = undefined
  })
  afterEach(() => {
    config.localStack = localStack
  })

  test('pairing accepts a loopback ws:// agent exactly like the password route', async () => {
    config.localStack = true
    for (const url of loopback) {
      docs = []
      calls = []

      expect((await pair({ url })).status).toBe(201)
      expect(calls[0]?.url).toBe(`http://${new URL(url).host}/_openab/pairing/exchange`)
      expect(docs[0]?.url).toBe(url)
      docs = []
      expect((await registerWithPassword(url)).status).toBe(201)
    }
  })

  test('outside the local stack both refuse plaintext loopback', async () => {
    config.localStack = false
    for (const url of loopback) {
      const paired = await pair({ url })

      expect(paired.status).toBe(422)
      expect(((await paired.json()) as { code: string }).code).toBe('invalid_runtime_url')
      expect((await registerWithPassword(url)).status).toBe(422)
    }
    expect(calls).toHaveLength(0)
  })
})
