import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { Hono } from 'hono'

import { config } from '@/config'
import { AppError } from '@/lib/errors'
import { useAuthMiddleware } from '@/lib/test/doubles/auth-middleware'
import { useByosSecrets } from '@/lib/test/doubles/byos-secrets'
import { useModels } from '@/lib/test/doubles/models'

import { personalCredentialRoutes } from './personal-credentials'

import type { EncryptedSecret } from '@/lib/byos/secrets'
import type { AuthVariables } from '@/middleware/auth'
import type { Context, Next } from 'hono'

type Doc = Record<string, unknown>

const pending: Doc[] = []
const saved: Doc[] = []

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, value]) => {
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('$exists' in value) return (doc[key] !== undefined) === value.$exists
      if ('$gt' in value) return (doc[key] as Date) > (value.$gt as Date)
    }

    return doc[key] === value
  })
}

function collection(rows: Doc[]) {
  return {
    insertOne: (doc: Doc) => {
      rows.push(doc)

      return Promise.resolve({ acknowledged: true })
    },
    findOneAndDelete: (filter: Doc) => {
      const index = rows.findIndex((doc) => matches(doc, filter))

      return Promise.resolve(index < 0 ? null : rows.splice(index, 1)[0])
    },
    findOneAndUpdate: (filter: Doc, update: { $set: Doc; $setOnInsert: Doc }) => {
      const doc = rows.find((row) => matches(row, filter))

      if (doc) Object.assign(doc, update.$set)
      else rows.push({ ...filter, ...update.$setOnInsert, ...update.$set })

      return Promise.resolve(doc ?? null)
    },
  }
}

useModels({
  personalCredentialPendingOAuth: () => collection(pending) as never,
  personalCredentials: () => collection(saved) as never,
})
const fakeSeal = (plaintext: string) => ({ plaintext }) as unknown as EncryptedSecret
const fakeOpen = (envelope: EncryptedSecret) =>
  (envelope as unknown as { plaintext: string }).plaintext

useByosSecrets({
  encryptGithubSecret: fakeSeal,
  decryptGithubSecret: fakeOpen,
  encryptLinearSecret: fakeSeal,
  decryptLinearSecret: fakeOpen,
})
// The signed-in member is whoever the test names in x-test-user.
useAuthMiddleware({
  requireAuth: async (c: Context<{ Variables: AuthVariables }>, next: Next) => {
    c.set('userId', c.req.header('x-test-user') ?? '')
    await next()
  },
})

const saveConfig = {
  github: { ...config.byos.github },
  linear: { ...config.byos.linear },
  publicBackendUrl: config.agent.publicBackendUrl,
}

// As in production: GitHub's install redirect is a desktop deep link, so the
// callback has to come from the backend's public URL, not the setup redirect.
Object.assign(config.agent, { publicBackendUrl: 'https://api.nuphos.test/' })

Object.assign(config.byos.github, {
  clientId: 'Iv1.client',
  clientSecret: 'gh-secret',
  setupRedirect: 'nuphos://github-callback',
  encryptionKey: 'k',
})
Object.assign(config.byos.linear, {
  clientId: 'lin-client',
  clientSecret: 'lin-secret',
  setupRedirect: 'https://elsewhere.test/linear-app/setup',
  encryptionKey: 'k',
})
afterAll(() => {
  Object.assign(config.byos.github, saveConfig.github)
  Object.assign(config.byos.linear, saveConfig.linear)
  Object.assign(config.agent, { publicBackendUrl: saveConfig.publicBackendUrl })
})

// Each provider's token exchange and identity lookup, answered for the approver.
const fetchSpy = spyOn(globalThis, 'fetch')

afterAll(() => fetchSpy.mockRestore())
fetchSpy.mockImplementation(((input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input)

  if (url.includes('github.com/login/oauth/access_token'))
    return Promise.resolve(
      Response.json({ access_token: 'ghu_v', refresh_token: 'ghr_v', expires_in: 28_800 }),
    )
  if (url.endsWith('/user')) return Promise.resolve(Response.json({ id: 9, login: 'victim' }))
  if (url.includes('linear.app/oauth/token'))
    return Promise.resolve(Response.json({ access_token: 'lin_v', expires_in: 3600 }))
  if (url.includes('linear.app/graphql'))
    return Promise.resolve(
      Response.json({
        data: {
          viewer: { id: 'u9', name: 'victim' },
          organization: { id: 'org-1', name: 'Acme', urlKey: 'acme' },
        },
      }),
    )

  return Promise.reject(new Error(`unexpected fetch ${url}`))
}) as typeof fetch)

const app = new Hono<{ Variables: AuthVariables }>()

app.onError((error, c) =>
  error instanceof AppError
    ? c.json({ code: error.code }, error.status as 400)
    : c.json({ code: 'internal' }, 500),
)
app.route('/personal-credentials', personalCredentialRoutes)

async function start(provider: string, userId: string): Promise<string> {
  const res = await app.request(`/personal-credentials/${provider}/start`, {
    method: 'POST',
    headers: { 'x-test-user': userId },
  })

  expect(res.status).toBe(200)
  const { state, authorizeUrl } = (await res.json()) as { state: string; authorizeUrl: string }

  expect(new URL(authorizeUrl).searchParams.get('redirect_uri')).toBe(
    `https://api.nuphos.test/personal-credentials/${provider}/callback`,
  )

  return state
}

/** Follows the provider redirect and returns the deep link the callback page opens. */
async function callback(provider: string, state: string): Promise<URL> {
  const res = await app.request(
    `/personal-credentials/${provider}/callback?state=${state}&code=provider-code`,
  )
  const html = await res.text()
  const href = /location\.href = "([^"]+)"/u.exec(html)?.[1] ?? ''

  return new URL(JSON.parse(`"${href}"`) as string)
}

function complete(provider: string, userId: string, state: string, code: string) {
  return app.request(`/personal-credentials/${provider}/complete`, {
    method: 'POST',
    headers: { 'x-test-user': userId, 'content-type': 'application/json' },
    body: JSON.stringify({ state, code }),
  })
}

beforeEach(() => {
  pending.length = 0
  saved.length = 0
})

describe.each(['github', 'linear'])('%s Personal Credential OAuth', (provider) => {
  test('the starter claims the staged grant with the callback code', async () => {
    const state = await start(provider, 'alice')
    const link = await callback(provider, state)

    expect(link.protocol).toBe('nuphos:')
    expect(saved).toHaveLength(0)
    const res = await complete(provider, 'alice', state, link.searchParams.get('code') ?? '')

    expect(res.status).toBe(200)
    expect(saved).toMatchObject([{ userId: 'alice', provider, login: 'victim' }])
  })

  test('another member cannot claim a grant someone else started', async () => {
    const state = await start(provider, 'attacker')
    const link = await callback(provider, state)
    const code = link.searchParams.get('code') ?? ''

    // The victim's app holds the code but did not start the flow.
    expect((await complete(provider, 'victim', state, code)).status).toBe(404)
    // The starter never receives the code, and guessing it fails.
    expect((await complete(provider, 'attacker', state, 'guessed')).status).toBe(404)
    expect(saved).toHaveLength(0)
  })

  test('a claim and a callback are single-use', async () => {
    const state = await start(provider, 'alice')
    const link = await callback(provider, state)
    const code = link.searchParams.get('code') ?? ''

    expect((await callback(provider, state)).searchParams.get('error')).toBe('invalid_state')
    expect((await complete(provider, 'alice', state, code)).status).toBe(200)
    expect((await complete(provider, 'alice', state, code)).status).toBe(404)
  })

  test('an expired request or staged grant is refused', async () => {
    const state = await start(provider, 'alice')

    pending[0]!.expiresAt = new Date(Date.now() - 1000)
    expect((await callback(provider, state)).searchParams.get('error')).toBe('invalid_state')

    const fresh = await start(provider, 'alice')
    const code = (await callback(provider, fresh)).searchParams.get('code') ?? ''

    pending.find((doc) => doc._id === fresh)!.expiresAt = new Date(Date.now() - 1000)
    expect((await complete(provider, 'alice', fresh, code)).status).toBe(404)
    expect(saved).toHaveLength(0)
  })
})
