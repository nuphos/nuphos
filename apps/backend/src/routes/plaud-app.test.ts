import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { errorHandler } from '@/lib/errors'
import { useByosSecrets } from '@/lib/test/doubles/byos-secrets'
import { useModels } from '@/lib/test/doubles/models'

import type { PlaudAccountBinding, PlaudPendingOAuth } from '@/models'

const TEAM_ID = new ObjectId()
const USER_ID = new ObjectId().toHexString()
const MARKER = 'upstream-secret-marker'
const seal = (value: string) => ({
  v: 1 as const,
  alg: 'A256GCM' as const,
  keyId: 'default',
  iv: '',
  authTag: '',
  ciphertext: value,
})

let pending: PlaudPendingOAuth[] = []
let stored: PlaudAccountBinding[] = []
let updates: Record<string, unknown>[] = []
let upstream: Record<string, { status: number; body: unknown }> = {}

useModels({
  teamByosBindings: () => ({
    findOne: async () => ({ _id: TEAM_ID, plaudAccounts: stored }),
    updateOne: async (_filter: unknown, update: Record<string, unknown>) => {
      updates.push(update)

      return { matchedCount: 1, modifiedCount: 1, upsertedId: null }
    },
  }),
  plaudPendingOAuth: () => ({
    findOneAndDelete: async ({ _id }: { _id: string }) => {
      const found = pending.find((doc) => doc._id === _id) ?? null

      pending = pending.filter((doc) => doc._id !== _id)

      return found
    },
  }),
})

useByosSecrets({
  encryptPlaudSecret: (value: string) => seal(value),
  decryptPlaudSecret: (envelope: { ciphertext: string }) => envelope.ciphertext,
})

const { plaudAppRoutes } = await import('@/routes/plaud-app')

const realFetch = globalThis.fetch

beforeEach(() => {
  pending = []
  stored = []
  updates = []
  upstream = {
    '/token': {
      status: 200,
      body: { access_token: 'pat_1', refresh_token: 'prt_1', expires_in: 3600 },
    },
    '/developer/api/open/third-party/users/current': {
      status: 200,
      body: { id: 'plaud-user-1', nickname: 'Ada', email: 'ada@example.com' },
    },
  }
  globalThis.fetch = (async (url: string) => {
    const reply = upstream[new URL(url).pathname] ?? { status: 404, body: {} }

    return new Response(JSON.stringify(reply.body), { status: reply.status })
  }) as unknown as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
})

function addPending(overrides: Partial<PlaudPendingOAuth> = {}): string {
  const state = new ObjectId().toHexString()

  pending.push({
    _id: state,
    teamId: TEAM_ID,
    requesterUserId: USER_ID,
    clientId: 'signed-client',
    redirectUri: 'https://api.example.com/plaud-app/callback',
    encryptedCodeVerifier: seal('verifier'),
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  })

  return state
}

async function callback(query: string): Promise<URL> {
  const app = new Hono()

  app.onError(errorHandler)
  app.route('/plaud-app', plaudAppRoutes)
  const html = await (await app.request(`/plaud-app/callback?${query}`)).text()
  const match = /location\.href = "([^"]+)"/.exec(html)

  return new URL(JSON.parse(`"${match![1]!}"`) as string)
}

describe('GET /plaud-app/callback', () => {
  test('binds the authorising Plaud user', async () => {
    const link = await callback(`state=${addPending()}&code=c1`)

    expect(link.searchParams.get('account_name')).toBe('Ada')
    expect(updates[0]?.$push).toMatchObject({
      plaudAccounts: { plaudUserId: 'plaud-user-1', clientId: 'signed-client' },
    })
  })

  test('a reconnect by the same Plaud user keeps the binding id', async () => {
    const id = new ObjectId()

    stored = [{ id, plaudUserId: 'plaud-user-1', label: 'Mine' } as PlaudAccountBinding]
    const link = await callback(`state=${addPending()}&code=c1`)

    expect(link.searchParams.get('binding_id')).toBe(id.toHexString())
    expect(updates[0]?.$push).toBeUndefined()
  })

  test('a replayed state is refused without a token exchange', async () => {
    const state = addPending()

    await callback(`state=${state}&code=c1`)
    updates = []
    const link = await callback(`state=${state}&code=c1`)

    expect(link.searchParams.get('error')).toBe('unknown_state')
    expect(updates).toHaveLength(0)
  })

  test('an expired authorization is refused', async () => {
    const link = await callback(
      `state=${addPending({ expiresAt: new Date(Date.now() - 1000) })}&code=c1`,
    )

    expect(link.searchParams.get('error')).toBe('expired')
    expect(updates).toHaveLength(0)
  })

  test('relays a denied consent and consumes the state', async () => {
    const link = await callback(`state=${addPending()}&error=access_denied`)

    expect(link.searchParams.get('error')).toBe('access_denied')
    expect(pending).toHaveLength(0)
  })

  test('never forwards an upstream error body to the desktop', async () => {
    upstream['/token'] = { status: 400, body: { error: 'invalid_grant', detail: MARKER } }
    const link = await callback(`state=${addPending()}&code=c1`)

    expect(link.searchParams.get('error')).toBe('exchange_failed')
    expect(link.searchParams.get('error_description')).toBe('Plaud /token failed (HTTP 400)')
    expect(link.toString()).not.toContain(MARKER)
  })
})
