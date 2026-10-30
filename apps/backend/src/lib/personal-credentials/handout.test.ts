import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { GithubApiError } from '@/lib/byos/github-http'
import { useByosSecrets } from '@/lib/test/doubles/byos-secrets'
import { useModels } from '@/lib/test/doubles/models'
import { usePersonalCredentialsGithub } from '@/lib/test/doubles/personal-credentials-github'

import { personalGithubToken, personalGoogleToken, personalLinearToken } from './handout'

import type { ProviderTokens } from './github'
import type { EncryptedSecret } from '@/lib/byos/secrets'
import type { PersonalCredential } from '@/models'

let rows: PersonalCredential[] = []
let visibleInstallations: number[] = []
let refreshResult: () => Promise<ProviderTokens>

const matches = (row: PersonalCredential, filter: Record<string, unknown>) =>
  Object.entries(filter).every(([key, value]) => {
    const actual = (row as Record<string, unknown>)[key]

    if (value instanceof ObjectId || value instanceof Date) return String(actual) === String(value)

    return actual === value
  })

const TEAM = new ObjectId().toHexString()
let teamClient: { clientId: string; encryptedClientSecret: EncryptedSecret } | null = null

useModels({
  teamByosBindings: () =>
    ({
      findOne: (filter: { _id: ObjectId }) =>
        Promise.resolve(
          filter._id.toHexString() === TEAM && teamClient
            ? { googleOAuthClient: teamClient }
            : null,
        ),
    }) as never,
  personalCredentials: () =>
    ({
      findOne: (filter: Record<string, unknown>) =>
        Promise.resolve(rows.find((row) => matches(row, filter)) ?? null),
      updateOne: (
        filter: Record<string, unknown>,
        update: { $set: Partial<PersonalCredential> },
      ) => {
        rows = rows.map((row) => (matches(row, filter) ? { ...row, ...update.$set } : row))

        return Promise.resolve({})
      },
      deleteOne: (filter: Record<string, unknown>) => {
        rows = rows.filter((row) => !matches(row, filter))

        return Promise.resolve({})
      },
    }) as never,
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
usePersonalCredentialsGithub({
  githubUserInstallationIds: () => Promise.resolve(visibleInstallations),
  refreshGithubToken: () => refreshResult(),
})

const sealed = fakeSeal

function credential(overrides: Partial<PersonalCredential>): PersonalCredential {
  const now = new Date()

  return {
    _id: new ObjectId(),
    userId: 'user-1',
    provider: 'github',
    providerUserId: '42',
    login: 'octocat',
    encryptedAccessToken: sealed('ghu_access'),
    encryptedRefreshToken: sealed('ghr_refresh'),
    accessTokenExpiresAt: new Date(Date.now() + 60 * 60_000),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

beforeEach(() => {
  rows = []
  visibleInstallations = []
  refreshResult = () => Promise.reject(new Error('unexpected refresh'))
})

describe('personalGithubToken', () => {
  test('returns the member token only for an installation they can see', async () => {
    rows = [credential({})]
    visibleInstallations = [7]

    expect(await personalGithubToken('user-1', 7)).toMatchObject({
      token: 'ghu_access',
      login: 'octocat',
    })
    expect(await personalGithubToken('user-1', 8)).toBeNull()
    expect(await personalGithubToken('user-2', 7)).toBeNull()
  })

  test('refreshes an expiring token and stores the rotated pair', async () => {
    rows = [credential({ userId: 'user-3', accessTokenExpiresAt: new Date(Date.now() + 60_000) })]
    visibleInstallations = [7]
    const expiresAt = new Date(Date.now() + 8 * 60 * 60_000)

    refreshResult = () =>
      Promise.resolve({ accessToken: 'ghu_new', refreshToken: 'ghr_new', expiresAt })

    expect(await personalGithubToken('user-3', 7)).toMatchObject({ token: 'ghu_new', expiresAt })
    expect(rows[0]?.encryptedAccessToken).toEqual(sealed('ghu_new'))
    expect(rows[0]?.encryptedRefreshToken).toEqual(sealed('ghr_new'))
  })

  test('drops a grant the provider refuses so the team token takes over', async () => {
    rows = [credential({ userId: 'user-4', accessTokenExpiresAt: new Date(Date.now() - 1000) })]
    refreshResult = () => Promise.reject(new GithubApiError(400, 'bad_refresh_token'))

    expect(await personalGithubToken('user-4', 7)).toBeNull()
    expect(rows).toHaveLength(0)
  })

  test('keeps the grant through a network or server error', async () => {
    rows = [credential({ userId: 'user-5', accessTokenExpiresAt: new Date(Date.now() - 1000) })]

    for (const error of [
      new Error('fetch failed'),
      new GithubApiError(503, 'unavailable'),
      new GithubApiError(429, 'rate limited'),
    ]) {
      refreshResult = () => Promise.reject(error)
      expect(await personalGithubToken('user-5', 7)).toBeNull()
    }
    expect(rows).toHaveLength(1)
  })
})

describe('personalLinearToken', () => {
  test('applies only to the workspace the member connected', async () => {
    rows = [
      credential({
        provider: 'linear',
        workspaceId: 'org-1',
        encryptedAccessToken: sealed('lin_access'),
        accessTokenExpiresAt: null,
      }),
    ]

    expect(await personalLinearToken('user-1', 'org-1')).toMatchObject({ token: 'lin_access' })
    expect(await personalLinearToken('user-1', 'org-2')).toBeNull()
  })
})

describe('personalGoogleToken', () => {
  const fetchSpy = spyOn(globalThis, 'fetch')
  let answer: () => Promise<Response>
  let requested: URLSearchParams | null = null

  fetchSpy.mockImplementation(((_url: string, init?: RequestInit) => {
    requested = new URLSearchParams((init?.body as string | undefined) ?? '')

    return answer()
  }) as unknown as typeof fetch)
  afterAll(() => fetchSpy.mockRestore())
  beforeEach(() => {
    teamClient = {
      clientId: 'team.apps.googleusercontent.com',
      encryptedClientSecret: sealed('team-secret'),
    }
    requested = null
  })

  const expired = (userId: string) =>
    credential({
      userId,
      provider: 'gmail',
      teamId: TEAM,
      accessTokenExpiresAt: new Date(Date.now() - 1000),
    })

  test('only a grant issued through this team applies', async () => {
    rows = [credential({ provider: 'gmail', teamId: TEAM, encryptedAccessToken: sealed('mail') })]

    expect(await personalGoogleToken('user-1', 'gmail', TEAM)).toMatchObject({ token: 'mail' })
    expect(await personalGoogleToken('user-1', 'gmail', new ObjectId().toHexString())).toBeNull()
  })

  test('refreshes with the team’s own client and keeps the stored refresh token', async () => {
    rows = [expired('g-3')]
    answer = () => Promise.resolve(Response.json({ access_token: 'ya29_new', expires_in: 3599 }))

    expect(await personalGoogleToken('g-3', 'gmail', TEAM)).toMatchObject({ token: 'ya29_new' })
    expect(requested?.get('client_id')).toBe('team.apps.googleusercontent.com')
    expect(requested?.get('client_secret')).toBe('team-secret')
    expect(rows[0]?.encryptedRefreshToken).toEqual(sealed('ghr_refresh'))
  })

  test('drops the grant when Google answers invalid_grant', async () => {
    rows = [expired('g-1')]
    answer = () => Promise.resolve(Response.json({ error: 'invalid_grant' }, { status: 400 }))

    expect(await personalGoogleToken('g-1', 'gmail', TEAM)).toBeNull()
    expect(rows).toHaveLength(0)
  })

  test('keeps the grant through a network error, a 5xx, a rate limit and a missing client', async () => {
    rows = [expired('g-2')]

    for (const next of [
      () => Promise.reject(new TypeError('fetch failed')),
      () => Promise.resolve(Response.json({ error: 'backend_error' }, { status: 503 })),
      () => Promise.resolve(Response.json({ error: 'rate_limit_exceeded' }, { status: 429 })),
    ]) {
      answer = next
      expect(await personalGoogleToken('g-2', 'gmail', TEAM)).toBeNull()
    }
    teamClient = null
    requested = null
    expect(await personalGoogleToken('g-2', 'gmail', TEAM)).toBeNull()
    expect(requested).toBeNull()
    expect(rows).toHaveLength(1)
  })
})
