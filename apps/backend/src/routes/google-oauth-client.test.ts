import { beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { AppError } from '@/lib/errors'
import { useByosSecrets } from '@/lib/test/doubles/byos-secrets'
import { useModels } from '@/lib/test/doubles/models'

import { googleOAuthClientRoutes } from './google-oauth-client'

import type { EncryptedSecret } from '@/lib/byos/secrets'
import type { TeamAuthVariables } from '@/middleware/auth'

const TEAM = new ObjectId().toHexString()
let doc: Record<string, unknown> | null = null
let grants: { teamId: string; provider: string }[] = []

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
      deleteMany: (filter: { teamId: string; provider: { $in: string[] } }) => {
        grants = grants.filter(
          (g) => g.teamId !== filter.teamId || !filter.provider.$in.includes(g.provider),
        )

        return Promise.resolve({})
      },
    }) as never,
})
useByosSecrets({
  encryptLinearSecret: (plaintext: string) => ({ sealed: plaintext }) as unknown as EncryptedSecret,
})

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

beforeEach(() => {
  doc = null
  grants = [
    { teamId: TEAM, provider: 'gmail' },
    { teamId: TEAM, provider: 'github' },
    { teamId: 'other-team', provider: 'gmail' },
  ]
})

const remove = () =>
  app.request('/', { method: 'DELETE', headers: { 'x-test-role': 'ADMINISTRATOR' } })

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

    expect(JSON.parse(text)).toEqual({ clientId: CLIENT.clientId })
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
    expect(await (await app.request('/')).json()).toEqual({ clientId: null })
  })

  test('removing or replacing the client drops the team’s Google grants', async () => {
    const teamGmail = { teamId: TEAM, provider: 'gmail' }

    await put('ADMINISTRATOR', CLIENT)
    // A new secret for the same client keeps them: their refresh tokens still work.
    await put('ADMINISTRATOR', { ...CLIENT, clientSecret: 'rotated' })
    expect(grants).toContainEqual(teamGmail)

    await put('ADMINISTRATOR', { ...CLIENT, clientId: 'other.apps.googleusercontent.com' })
    expect(grants).not.toContainEqual(teamGmail)
    expect(grants).toHaveLength(2)

    grants.push(teamGmail)
    await remove()
    expect(grants).toEqual([
      { teamId: TEAM, provider: 'github' },
      { teamId: 'other-team', provider: 'gmail' },
    ])
  })
})
