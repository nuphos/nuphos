import { beforeEach, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useByosSecrets } from '@/lib/test/doubles/byos-secrets'
import { useModels } from '@/lib/test/doubles/models'
import { usePersonalCredentialsGithub } from '@/lib/test/doubles/personal-credentials-github'

import {
  googleCredentialFor,
  personalGithubToken,
  personalLinearToken,
  personalOwnToken,
} from './handout'

import type { EncryptedSecret } from '@/lib/byos/secrets'
import type { PersonalCredential } from '@/models'

let rows: PersonalCredential[] = []
// The installations each GitHub token (by plaintext) can see.
let visible: Record<string, number[]> = {}

const sealed = (plaintext: string) => ({ plaintext }) as unknown as EncryptedSecret
const matches = (row: PersonalCredential, filter: Record<string, unknown>) =>
  Object.entries(filter).every(([key, value]) => (row as Record<string, unknown>)[key] === value)

useModels({
  personalCredentials: () =>
    ({
      find: (filter: Record<string, unknown>) => ({
        toArray: () => Promise.resolve(rows.filter((row) => matches(row, filter))),
      }),
    }) as never,
})
useByosSecrets({
  encryptGithubSecret: sealed,
  decryptGithubSecret: (envelope: EncryptedSecret) =>
    (envelope as unknown as { plaintext: string }).plaintext,
  encryptLinearSecret: sealed,
  decryptLinearSecret: (envelope: EncryptedSecret) =>
    (envelope as unknown as { plaintext: string }).plaintext,
})
usePersonalCredentialsGithub({
  githubUserInstallationIds: (token: string) => Promise.resolve(visible[token] ?? []),
})

const account = (provider: 'github' | 'linear', login: string, extra = {}): PersonalCredential => ({
  _id: new ObjectId(),
  userId: 'user-1',
  provider,
  providerUserId: login,
  login,
  encryptedAccessToken: sealed(`token-${login}`),
  encryptedRefreshToken: null,
  accessTokenExpiresAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...extra,
})
const ids = (...docs: PersonalCredential[]) => docs.map((doc) => doc._id.toHexString())

beforeEach(() => {
  rows = []
  visible = {}
})

describe('several GitHub accounts', () => {
  test('the installation picks the account that can see it', async () => {
    const work = account('github', 'work')
    const home = account('github', 'home')

    rows = [work, home]
    visible = { 'token-work': [7], 'token-home': [8] }

    expect(await personalGithubToken('user-1', 7, ids(work, home))).toMatchObject({ login: 'work' })
    expect(await personalGithubToken('user-1', 8, ids(work, home))).toMatchObject({ login: 'home' })
    expect(await personalGithubToken('user-1', 9, ids(work, home))).toBeNull()
  })

  test('two accounts that can see it, and none named, is a 409 that lists them', async () => {
    const work = account('github', 'work')
    const home = account('github', 'home')

    rows = [work, home]
    visible = { 'token-work': [7], 'token-home': [7] }

    await expect(personalGithubToken('user-1', 7, ids(work, home))).rejects.toMatchObject({
      status: 409,
      code: 'personal_credential_account_required',
    })
    // Allowing only one of them makes it the answer.
    expect(await personalGithubToken('user-1', 7, ids(home))).toMatchObject({ login: 'home' })
  })

  test('a provider-only selection covers every account, and still asks which', async () => {
    rows = [account('github', 'work'), account('github', 'home')]
    visible = { 'token-work': [7], 'token-home': [7] }

    await expect(personalGithubToken('user-1', 7)).rejects.toMatchObject({
      status: 409,
      code: 'personal_credential_account_required',
    })
    rows = [account('github', 'work')]
    expect(await personalGithubToken('user-1', 7)).toMatchObject({ login: 'work' })
  })

  test('a named account outside the selection is refused, and own-token calls name one', async () => {
    const work = account('github', 'work')
    const home = account('github', 'home')

    rows = [work, home]
    await expect(
      personalOwnToken('user-1', 'github', ids(home)[0], ids(work)),
    ).rejects.toMatchObject({
      status: 403,
    })
    await expect(
      personalOwnToken('user-1', 'github', undefined, ids(work, home)),
    ).rejects.toMatchObject({
      status: 409,
    })
    expect(await personalOwnToken('user-1', 'github', ids(home)[0], ids(work, home))).toMatchObject(
      { login: 'home' },
    )
  })
})

describe('several Linear workspaces', () => {
  test('each binding uses the account of its own workspace', async () => {
    const one = account('linear', 'one', { workspaceId: 'org-1' })
    const two = account('linear', 'two', { workspaceId: 'org-2' })

    rows = [one, two]

    expect(await personalLinearToken('user-1', 'org-1', ids(one, two))).toMatchObject({
      login: 'one',
    })
    expect(await personalLinearToken('user-1', 'org-2', ids(one, two))).toMatchObject({
      login: 'two',
    })
    // Allowing only workspace 1 leaves workspace 2 to the team token.
    expect(await personalLinearToken('user-1', 'org-2', ids(one))).toBeNull()
  })

  test('a provider-only selection reaches each workspace', async () => {
    rows = [
      account('linear', 'one', { workspaceId: 'org-1' }),
      account('linear', 'two', { workspaceId: 'org-2' }),
    ]

    expect(await personalLinearToken('user-1', 'org-1')).toMatchObject({ login: 'one' })
    expect(await personalLinearToken('user-1', 'org-2')).toMatchObject({ login: 'two' })
  })
})

describe('a selection that ticks only the provider', () => {
  const gmail = (login: string) =>
    account('github', login, { teamId: 'team-1' }) as PersonalCredential

  test("names an account: either of the member's two Google accounts is reachable", async () => {
    const one = { ...gmail('a@x.com'), provider: 'gmail' as never }
    const two = { ...gmail('b@x.com'), provider: 'gmail' as never }

    rows = [one, two]

    expect(await googleCredentialFor('user-1', 'gmail', 'team-1', ids(one)[0])).toMatchObject({
      login: 'a@x.com',
    })
    expect(await googleCredentialFor('user-1', 'gmail', 'team-1', ids(two)[0])).toMatchObject({
      login: 'b@x.com',
    })
  })

  test('names none: the agent is told to ask, with both accounts listed', async () => {
    rows = [
      { ...gmail('a@x.com'), provider: 'gmail' as never },
      { ...gmail('b@x.com'), provider: 'gmail' as never },
    ]

    await expect(googleCredentialFor('user-1', 'gmail', 'team-1')).rejects.toMatchObject({
      status: 409,
      code: 'personal_credential_account_required',
    })
  })

  test('an explicit empty list allows nothing, unlike an absent one', async () => {
    const one = { ...gmail('a@x.com'), provider: 'gmail' as never }

    rows = [one]

    await expect(
      googleCredentialFor('user-1', 'gmail', 'team-1', undefined, []),
    ).rejects.toMatchObject({
      status: 403,
    })
  })

  test('one account still works with none named', async () => {
    rows = [{ ...gmail('a@x.com'), provider: 'gmail' as never }]

    expect(await googleCredentialFor('user-1', 'gmail', 'team-1')).toMatchObject({
      login: 'a@x.com',
    })
  })
})
