import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import yaml from 'js-yaml'

import { configFile } from './config.ts'

import type { UserInfo } from '../auth-status.ts'
import type { TokenStore } from './token-store.ts'

const CLOUD = 'https://api.nuphos.ai'
const SELF = 'https://nuphos.example.com'
const ALICE: UserInfo = { id: 'alice', name: 'Alice', email: 'a@example.com', username: 'alice' }
const BOB: UserInfo = { id: 'bob', name: 'Bob', email: 'b@example.com', username: 'bob' }

async function harness({ secure = true } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nuphos-accounts-'))
  const file = path.join(dir, 'desktop.yaml')
  const items = new Map<string, string>()
  const store: TokenStore = {
    get: (account) => Promise.resolve(items.get(account) ?? null),
    set: (account, token) => {
      items.set(account, token)

      return Promise.resolve()
    },
    delete: (account) => {
      items.delete(account)

      return Promise.resolve()
    },
  }
  let api = CLOUD
  const kept: string[] = []
  const signedIn: { api: string; token: string | null; userId: string | null }[] = []
  const config = configFile({
    path: file,
    store,
    secure: () => secure,
    apiUrl: () => api,
    onAccount: (next, token, userId) => {
      // As the app does: the backend follows the account.
      api = next
      signedIn.push({ api: next, token, userId })
    },
    keepBackend: (next) => {
      kept.push(next)
    },
  })
  const onDisk = async () => yaml.load(await fs.readFile(file, 'utf8')) as Record<string, unknown>

  return {
    config,
    file,
    items,
    kept,
    signedIn,
    onDisk,
    useBackend: (next: string) => {
      api = next
    },
  }
}

for (const secure of [true, false]) {
  const where = secure ? 'keychain' : 'file'

  test(`${where}: switching makes a waiting account active on its own backend`, async () => {
    const h = await harness({ secure })

    await h.config.write({ token: 'tok-alice', userInfo: ALICE })
    h.useBackend(SELF)
    await h.config.write({ token: 'tok-bob', userInfo: BOB })

    await h.config.switchTo(`alice@${CLOUD}`)
    assert.deepEqual(h.signedIn.at(-1), { api: CLOUD, token: 'tok-alice', userId: 'alice' })
    assert.equal((await h.config.read()).token, 'tok-alice')
    assert.deepEqual(await h.config.list(), [
      { key: `alice@${CLOUD}`, api: CLOUD, userInfo: ALICE, active: true },
      { key: `bob@${SELF}`, api: SELF, userInfo: BOB, active: false },
    ])

    // And back: Bob's token went with him, to his backend.
    await h.config.switchTo(`bob@${SELF}`)
    assert.deepEqual(h.signedIn.at(-1), { api: SELF, token: 'tok-bob', userId: 'bob' })
    assert.equal((await h.config.read()).token, 'tok-bob')
  })

  test(`${where}: the same user on two backends is two accounts`, async () => {
    const h = await harness({ secure })

    await h.config.write({ token: 'tok-cloud', userInfo: ALICE })
    h.useBackend(SELF)
    await h.config.write({ token: 'tok-self', userInfo: ALICE })

    assert.deepEqual(
      (await h.config.list()).map((a) => a.key),
      [`alice@${SELF}`, `alice@${CLOUD}`],
    )
  })

  test(`${where}: signing out the active account leaves the others signed in`, async () => {
    const h = await harness({ secure })

    await h.config.write({ token: 'tok-alice', userInfo: ALICE })
    await h.config.write({ token: 'tok-bob', userInfo: BOB })
    await h.config.write({})

    assert.equal((await h.config.read()).token, undefined)
    assert.deepEqual(
      (await h.config.list()).map((a) => [a.key, a.active]),
      [[`alice@${CLOUD}`, false]],
    )
    if (secure) assert.deepEqual([...h.items.keys()], [`alice@${CLOUD}`])
    await h.config.switchTo(`alice@${CLOUD}`)
    assert.equal((await h.config.read()).token, 'tok-alice')
  })

  test(`${where}: signing a waiting account out removes it and hands back its token`, async () => {
    const h = await harness({ secure })

    await h.config.write({ token: 'tok-alice', userInfo: ALICE })
    await h.config.write({ token: 'tok-bob', userInfo: BOB })
    const before = h.signedIn.length

    assert.deepEqual(await h.config.forgetAccount(`alice@${CLOUD}`), {
      api: CLOUD,
      token: 'tok-alice',
    })
    assert.equal(h.signedIn.length, before, 'the active account is untouched')
    assert.equal((await h.config.read()).token, 'tok-bob')
    assert.deepEqual(
      (await h.config.list()).map((a) => a.key),
      [`bob@${CLOUD}`],
    )
    assert.equal(h.items.has(`alice@${CLOUD}`), false)
    assert.equal(await h.config.forgetAccount(`alice@${CLOUD}`), null)
  })
}

test('signing in again as the same user keeps one account', async () => {
  const h = await harness()

  await h.config.write({ token: 'tok-1', userInfo: ALICE })
  await h.config.write({ token: 'tok-bob', userInfo: BOB })
  await h.config.write({ token: 'tok-2', userInfo: ALICE })

  assert.deepEqual(
    (await h.config.list()).map((a) => a.key),
    [`alice@${CLOUD}`, `bob@${CLOUD}`],
  )
  assert.equal((await h.config.read()).token, 'tok-2')
})

test('a refreshed identity for the active account does not add it to the list', async () => {
  const h = await harness()

  await h.config.write({ token: 'tok-alice', userInfo: ALICE })
  await h.config.write({ token: 'tok-bob', userInfo: BOB })
  // What the startup check writes back: the file as read, with a fresh identity.
  const cfg = await h.config.read()

  await h.config.write({ ...cfg, userInfo: { ...BOB, name: 'Robert' } })
  assert.deepEqual(
    (await h.config.list()).map((a) => a.key),
    [`bob@${CLOUD}`, `alice@${CLOUD}`],
  )
})

test('an account whose keychain item is gone asks for a new sign-in instead of switching', async () => {
  const h = await harness()

  await h.config.write({ token: 'tok-alice', userInfo: ALICE })
  await h.config.write({ token: 'tok-bob', userInfo: BOB })
  h.items.delete(`alice@${CLOUD}`)

  await assert.rejects(h.config.switchTo(`alice@${CLOUD}`), /Sign in to that account again/u)
  assert.equal((await h.config.read()).token, 'tok-bob')
})

test('an account that is not signed in here cannot be switched to', async () => {
  const h = await harness()

  await h.config.write({ token: 'tok-alice', userInfo: ALICE })
  await assert.rejects(h.config.switchTo(`bob@${CLOUD}`), /not signed in on this computer/u)
})

test('a file from before the account list is one account on the current backend', async () => {
  const h = await harness()

  await fs.writeFile(h.file, yaml.dump({ token: 'tok-alice', userInfo: ALICE }))
  assert.deepEqual(await h.config.list(), [
    { key: `alice@${CLOUD}`, api: CLOUD, userInfo: ALICE, active: true },
  ])
  await h.config.write({ token: 'tok-bob', userInfo: BOB })
  await h.config.switchTo(`alice@${CLOUD}`)
  assert.equal((await h.config.read()).token, 'tok-alice')
})
