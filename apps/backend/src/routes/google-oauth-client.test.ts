import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { AppError } from '@/lib/errors'
import { useByosSecrets } from '@/lib/test/doubles/byos-secrets'
import { useModels } from '@/lib/test/doubles/models'

import { googleOAuthClientRoutes } from './google-oauth-client'

import type { EncryptedSecret } from '@/lib/byos/secrets'
import type { TeamAuthVariables } from '@/middleware/auth'

type Grant = {
  teamId: string
  provider: string
  userId: string
  encryptedAccessToken: EncryptedSecret
}

const TEAM = new ObjectId().toHexString()
let doc: Record<string, unknown> | null = null
let grants: Grant[] = []
let failDelete = false

useModels({
  teamByosBindings: () =>
    ({
      findOne: () => Promise.resolve(doc),
      findOneAndUpdate: (_filter: unknown, update: { $set: Record<string, unknown> }) => {
        const before = doc

        doc = { ...doc, ...update.$set }

        return Promise.resolve(before)
      },
      updateOne: (
        _filter: unknown,
        update: { $set?: Record<string, unknown>; $unset?: Record<string, unknown> },
      ) => {
        doc = { ...doc, ...update.$set }
        for (const key of Object.keys(update.$unset ?? {})) delete doc[key]

        return Promise.resolve({})
      },
    }) as never,
  personalCredentials: () =>
    ({
      find: (filter: { teamId: string; provider: { $in: string[] } }) => ({
        toArray: () =>
          Promise.resolve(
            grants.filter(
              (g) => g.teamId === filter.teamId && filter.provider.$in.includes(g.provider),
            ),
          ),
      }),
      deleteMany: (filter: { teamId: string; provider: { $in: string[] } }) => {
        if (failDelete) return Promise.reject(new Error('mongo is down'))
        grants = grants.filter(
          (g) => g.teamId !== filter.teamId || !filter.provider.$in.includes(g.provider),
        )

        return Promise.resolve({})
      },
    }) as never,
})
useByosSecrets({
  encryptLinearSecret: (plaintext: string) => ({ sealed: plaintext }) as unknown as EncryptedSecret,
  decryptLinearSecret: (envelope: EncryptedSecret) =>
    (envelope as unknown as { sealed: string }).sealed,
})

const revokeSpy = spyOn(globalThis, 'fetch')
const revoked: string[] = []
let failRevoke = false

afterAll(() => revokeSpy.mockRestore())
revokeSpy.mockImplementation(((input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)

  if (!url.includes('oauth2.googleapis.com/revoke'))
    return Promise.reject(new Error(`unexpected fetch ${url}`))
  if (failRevoke) return Promise.reject(new Error('network down'))
  revoked.push(new URLSearchParams((init?.body as string | undefined) ?? '').get('token') ?? '')

  return Promise.resolve(new Response(null, { status: 200 }))
}) as typeof fetch)

// The caller's team role is whatever the test names in x-test-role.
const app = new Hono<{ Variables: TeamAuthVariables }>()

app.onError((error, c) =>
  error instanceof AppError
    ? c.json({ code: error.code }, error.status as 400)
    : c.json({ code: 'internal' }, 500),
)
app.use('*', async (c, next) => {
  c.set('userId', 'admin-1')
  c.set('teamId', TEAM)
  c.set('teamRole', (c.req.header('x-test-role') ?? 'MEMBER') as never)
  await next()
})
app.route('/', googleOAuthClientRoutes)

const CLIENT = { clientId: 'team.apps.googleusercontent.com', clientSecret: 'GOCSPX-secret' }

function put(role: string, body: unknown) {
  return app.request('/', {
    method: 'PUT',
    headers: { 'x-test-role': role, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const remove = () =>
  app.request('/', { method: 'DELETE', headers: { 'x-test-role': 'ADMINISTRATOR' } })

function grant(
  userId: string,
  provider: string,
  teamId = TEAM,
  token = `${userId}-${provider}`,
): Grant {
  return {
    teamId,
    provider,
    userId,
    encryptedAccessToken: { sealed: token } as unknown as EncryptedSecret,
  }
}

const remaining = () => grants.map((g) => `${g.userId}:${g.provider}`)

beforeEach(() => {
  doc = null
  failDelete = false
  failRevoke = false
  revoked.length = 0
  grants = [
    grant('alice', 'gmail'),
    grant('alice', 'google-drive'),
    grant('bob', 'gmail'),
    grant('alice', 'github'),
    grant('carol', 'gmail', 'other-team'),
  ]
})

describe('team Google OAuth client', () => {
  test('an admin saves it with the secret sealed, and no read returns the secret', async () => {
    const res = await put('ADMINISTRATOR', CLIENT)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ clientId: CLIENT.clientId })
    expect(doc?.googleOAuthClient).toMatchObject({
      clientId: CLIENT.clientId,
      encryptedClientSecret: { sealed: CLIENT.clientSecret },
      updatedBy: 'admin-1',
    })
    const read = await app.request('/', { headers: { 'x-test-role': 'MEMBER' } })
    const text = await read.text()

    expect(JSON.parse(text)).toEqual({ clientId: CLIENT.clientId, composio: false })
    expect(text).not.toContain(CLIENT.clientSecret)
  })

  test('members cannot change or remove it', async () => {
    expect((await put('MEMBER', CLIENT)).status).toBe(403)
    expect((await app.request('/', { method: 'DELETE' })).status).toBe(403)
    expect(doc).toBeNull()
  })

  test('rejects something that is not a Google client ID', async () => {
    expect((await put('ADMINISTRATOR', { ...CLIENT, clientId: 'not-a-client' })).status).toBe(400)
    expect(doc).toBeNull()
  })

  test('an admin removes it, and reads report none', async () => {
    await put('ADMINISTRATOR', CLIENT)
    const res = await remove()

    expect(res.status).toBe(204)
    expect(await (await app.request('/')).json()).toEqual({ clientId: null, composio: false })
  })

  test('a different client revokes the team’s grants once per member, and drops them', async () => {
    await put('ADMINISTRATOR', CLIENT)
    // The first save had no client before it, so it ended nothing.
    expect(revoked).toEqual([])
    expect(grants).toHaveLength(5)

    await put('ADMINISTRATOR', { ...CLIENT, clientId: 'other.apps.googleusercontent.com' })

    // Alice's two grants share one authorization, so one revoke covers both.
    expect([...revoked].sort((a, b) => a.localeCompare(b))).toEqual(['alice-gmail', 'bob-gmail'])
    // Only this team's Google grants went: neither GitHub nor another team.
    expect(remaining()).toEqual(['alice:github', 'carol:gmail'])
  })

  test('a new secret for the same client keeps the grants and their authorization', async () => {
    await put('ADMINISTRATOR', CLIENT)
    await put('ADMINISTRATOR', { ...CLIENT, clientSecret: 'rotated' })

    // The refresh tokens still work with the same client, so nothing ends.
    expect(revoked).toEqual([])
    expect(grants).toHaveLength(5)
  })

  test('removing the client revokes its grants too', async () => {
    await put('ADMINISTRATOR', CLIENT)
    expect((await remove()).status).toBe(204)

    expect([...revoked].sort((a, b) => a.localeCompare(b))).toEqual(['alice-gmail', 'bob-gmail'])
    expect(remaining()).toEqual(['alice:github', 'carol:gmail'])
    expect(doc?.googleOAuthClient).toBeUndefined()
  })

  test('a failed cleanup changes nothing, so the save can be retried', async () => {
    await put('ADMINISTRATOR', CLIENT)
    failDelete = true

    const failed = await put('ADMINISTRATOR', {
      ...CLIENT,
      clientId: 'other.apps.googleusercontent.com',
    })

    expect(failed.status).toBe(500)
    // The client was not replaced: its grants still belong to it.
    expect((doc?.googleOAuthClient as { clientId: string }).clientId).toBe(CLIENT.clientId)
    expect(grants).toHaveLength(5)

    failDelete = false

    expect(
      (
        await put('ADMINISTRATOR', {
          ...CLIENT,
          clientId: 'other.apps.googleusercontent.com',
        })
      ).status,
    ).toBe(200)
    expect(remaining()).toEqual(['alice:github', 'carol:gmail'])
  })

  test('a failed revoke at Google still deletes the grants locally', async () => {
    await put('ADMINISTRATOR', CLIENT)
    failRevoke = true

    const res = await put('ADMINISTRATOR', {
      ...CLIENT,
      clientId: 'other.apps.googleusercontent.com',
    })

    expect(res.status).toBe(200)
    // Given up on at Google, but no stored token outlives the client either.
    expect(remaining()).toEqual(['alice:github', 'carol:gmail'])
  })
})
