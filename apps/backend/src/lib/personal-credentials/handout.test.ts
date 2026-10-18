import { beforeEach, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useByosSecrets } from '@/lib/test/doubles/byos-secrets'
import { useModels } from '@/lib/test/doubles/models'
import { usePersonalCredentialsGithub } from '@/lib/test/doubles/personal-credentials-github'

import { personalGithubToken, personalLinearToken } from './handout'

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

useModels({
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

  test('drops a grant whose refresh fails so the team token takes over', async () => {
    rows = [credential({ userId: 'user-4', accessTokenExpiresAt: new Date(Date.now() - 1000) })]
    refreshResult = () => Promise.reject(new Error('bad_refresh_token'))

    expect(await personalGithubToken('user-4', 7)).toBeNull()
    expect(rows).toHaveLength(0)
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
