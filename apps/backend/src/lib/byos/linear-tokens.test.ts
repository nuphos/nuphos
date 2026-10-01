import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { config } from '@/config'
import { useByosSecrets } from '@/lib/test/doubles/byos-secrets'
import { useModels } from '@/lib/test/doubles/models'

import { LinearApiError } from './linear-http'
import {
  getAccessToken,
  invalidateAccessToken,
  LinearReconnectRequired,
  withLinearAccessToken,
} from './linear-tokens'

import type { EncryptedEnvelope, LinearWorkspaceBinding } from '@/models'

const TEAM_ID = new ObjectId('69e989027ab63e8d6a0ffcb6')
const BINDING_ID = new ObjectId('6a7ec8a37dd630cea5e4002c')
const HOUR = 60 * 60 * 1000

const envelope = (ciphertext: string): EncryptedEnvelope => ({
  v: 1,
  alg: 'A256GCM',
  keyId: 'test',
  iv: 'iv',
  authTag: 'tag',
  ciphertext,
})

useByosSecrets({
  decryptLinearSecret: (env) => env.ciphertext,
  encryptLinearSecret: (plain) => envelope(plain),
})

function binding(opts: {
  accessToken: string
  refreshToken?: string | null
  expiresInMs?: number
}): LinearWorkspaceBinding {
  const refreshToken = opts.refreshToken === undefined ? 'refresh-1' : opts.refreshToken

  return {
    id: BINDING_ID,
    label: 'Zeabur',
    workspaceId: 'ws',
    workspaceName: 'Zeabur',
    organizationUrlKey: 'zeabur',
    accountId: 'acct',
    accountName: 'Nuphos',
    scope: 'read write',
    encryptedAccessToken: envelope(opts.accessToken),
    encryptedRefreshToken: refreshToken === null ? null : envelope(refreshToken),
    accessTokenExpiresAt: new Date(Date.now() + (opts.expiresInMs ?? 12 * HOUR)),
    createdAt: new Date(0),
  }
}

let stored: LinearWorkspaceBinding | null = null
let writes: Record<string, unknown>[] = []

useModels({
  teamByosBindings: () => ({
    findOne: async () => (stored ? { _id: TEAM_ID, linearWorkspaces: [stored] } : null),
    updateOne: async (_filter: unknown, update: { $set: Record<string, unknown> }) => {
      writes.push(update.$set)

      return { matchedCount: 1, modifiedCount: 1 }
    },
  }),
})

type TokenReply = { status: number; body: unknown }

let tokenReplies: TokenReply[] = []
let refreshRequests: URLSearchParams[] = []
const realFetch = globalThis.fetch
const realCredentials = { ...config.byos.linear }

beforeAll(() => {
  config.byos.linear.clientId = 'client'
  config.byos.linear.clientSecret = 'secret'
})

afterAll(() => {
  config.byos.linear.clientId = realCredentials.clientId
  config.byos.linear.clientSecret = realCredentials.clientSecret
})

beforeEach(() => {
  invalidateAccessToken(TEAM_ID, BINDING_ID)
  stored = null
  writes = []
  tokenReplies = []
  refreshRequests = []
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    refreshRequests.push(new URLSearchParams(typeof init?.body === 'string' ? init.body : ''))
    const reply = tokenReplies.shift()

    if (!reply) throw new Error('unexpected Linear token request')

    return new Response(JSON.stringify(reply.body), { status: reply.status })
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
})

const rotated = (access: string, refresh: string): TokenReply => ({
  status: 200,
  body: { access_token: access, token_type: 'Bearer', expires_in: 86399, refresh_token: refresh },
})

const unauthorized = () =>
  new LinearApiError(401, 'Linear GraphQL failed: 401 Authentication required')

function linearAccepting(valid: string) {
  const seen: string[] = []
  const run = async (token: string) => {
    seen.push(token)
    if (token !== valid) throw unauthorized()

    return 'ok'
  }

  return { run, seen }
}

describe('getAccessToken', () => {
  test('serves a token another replica stored over this process cached one', async () => {
    expect(
      await getAccessToken(TEAM_ID, binding({ accessToken: 'mine', expiresInMs: 2 * HOUR })),
    ).toBe('mine')

    const refreshedElsewhere = binding({ accessToken: 'theirs', expiresInMs: 24 * HOUR })

    expect(await getAccessToken(TEAM_ID, refreshedElsewhere)).toBe('theirs')
    expect(refreshRequests).toHaveLength(0)
  })

  test('concurrent handouts of an expiring token share one refresh and persist the rotation', async () => {
    tokenReplies = [rotated('fresh', 'refresh-2')]
    const expiring = binding({ accessToken: 'old', expiresInMs: 30_000 })

    const tokens = await Promise.all([
      getAccessToken(TEAM_ID, expiring),
      getAccessToken(TEAM_ID, expiring),
      getAccessToken(TEAM_ID, expiring),
    ])

    expect(tokens).toEqual(['fresh', 'fresh', 'fresh'])
    expect(refreshRequests).toHaveLength(1)
    expect(refreshRequests[0]?.get('refresh_token')).toBe('refresh-1')
    expect(writes).toHaveLength(1)
    expect(writes[0]?.['linearWorkspaces.$.encryptedRefreshToken']).toEqual(envelope('refresh-2'))
  })
})

describe('withLinearAccessToken', () => {
  test('a 401 retries with the token another replica stored, without refreshing', async () => {
    const stale = binding({ accessToken: 'revoked', expiresInMs: 6 * HOUR })

    await getAccessToken(TEAM_ID, stale)
    stored = binding({ accessToken: 'current', expiresInMs: 23 * HOUR })
    const linear = linearAccepting('current')

    expect(await withLinearAccessToken(TEAM_ID, stale, linear.run)).toBe('ok')
    expect(linear.seen).toEqual(['revoked', 'current'])
    expect(refreshRequests).toHaveLength(0)
  })

  test('a 401 on the stored token forces one refresh and later calls use the new token', async () => {
    const row = binding({ accessToken: 'revoked', expiresInMs: 6 * HOUR })

    stored = row
    tokenReplies = [rotated('fresh', 'refresh-2')]
    const linear = linearAccepting('fresh')

    expect(await withLinearAccessToken(TEAM_ID, row, linear.run)).toBe('ok')
    expect(await withLinearAccessToken(TEAM_ID, row, linear.run)).toBe('ok')
    expect(linear.seen).toEqual(['revoked', 'fresh', 'fresh'])
    expect(refreshRequests).toHaveLength(1)
  })

  test('a rejected refresh token asks for a reconnect', async () => {
    const row = binding({ accessToken: 'revoked', expiresInMs: 6 * HOUR })

    stored = row
    tokenReplies = [{ status: 400, body: { error: 'invalid_grant' } }]

    await expect(
      withLinearAccessToken(TEAM_ID, row, linearAccepting('never').run),
    ).rejects.toBeInstanceOf(LinearReconnectRequired)
    expect(writes).toHaveLength(0)
  })

  test('a 401 on a binding with no refresh token asks for a reconnect', async () => {
    const row = binding({ accessToken: 'revoked', refreshToken: null })

    stored = row

    await expect(
      withLinearAccessToken(TEAM_ID, row, linearAccepting('never').run),
    ).rejects.toBeInstanceOf(LinearReconnectRequired)
  })

  test('a 401 on the retried token asks for a reconnect and is never served again', async () => {
    const row = binding({ accessToken: 'revoked', expiresInMs: 6 * HOUR })

    stored = row
    tokenReplies = [rotated('also-dead', 'refresh-2'), rotated('fresh', 'refresh-3')]

    await expect(
      withLinearAccessToken(TEAM_ID, row, linearAccepting('fresh').run),
    ).rejects.toBeInstanceOf(LinearReconnectRequired)
    expect(await getAccessToken(TEAM_ID, row)).toBe('fresh')
  })

  test('errors other than 401 pass through without a retry', async () => {
    const row = binding({ accessToken: 'ok-token' })
    let calls = 0

    await expect(
      withLinearAccessToken(TEAM_ID, row, async () => {
        calls += 1
        throw new LinearApiError(500, 'boom')
      }),
    ).rejects.toThrow('boom')
    expect(calls).toBe(1)
  })
})
