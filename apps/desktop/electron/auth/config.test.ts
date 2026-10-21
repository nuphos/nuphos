import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import yaml from 'js-yaml'

import { configFile } from './config.ts'
import { secureStorageEnabled } from './token-store.ts'

import type { UserInfo } from '../auth-status.ts'
import type { TokenStore } from './token-store.ts'

const USER: UserInfo = { id: 'u1', name: 'Bruce', email: 'bruce@example.com', username: 'bruce' }
const ACCOUNT = 'u1@https://api.nuphos.ai'
const API = 'https://api.nuphos.ai'

async function harness({ secure = true, failSet = false, gated = false } = {}) {
  let api = 'https://api.nuphos.ai/'
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nuphos-config-'))
  const file = path.join(dir, 'desktop.yaml')
  const legacy = path.join(dir, 'cli.yaml')
  const items = new Map<string, string>()
  const calls: string[] = []
  // When gated, keychain writes wait for release(), so a test can act mid-write.
  let release: () => void = () => undefined
  const opened = new Promise<void>((resolve) => {
    release = resolve
  })
  const gate = gated ? opened : Promise.resolve()
  const store: TokenStore = {
    get: (account) => {
      calls.push(`get ${account}`)

      return Promise.resolve(items.get(account) ?? null)
    },
    set: async (account, token) => {
      calls.push(`set ${account}`)
      await gate
      if (failSet) throw new Error('locked')
      items.set(account, token)
    },
    delete: (account) => {
      calls.push(`delete ${account}`)
      items.delete(account)

      return Promise.resolve()
    },
  }
  const tokens: (string | null)[] = []
  const config = configFile({
    path: file,
    store,
    secure: () => secure,
    apiUrl: () => api,
    setApiUrl: (url) => {
      api = url
    },
    onToken: (token) => tokens.push(token),
    legacyPath: legacy,
  })
  const onDisk = async (at = file) =>
    yaml.load(await fs.readFile(at, 'utf8')) as Record<string, unknown>

  const keychainWriteStarted = async () => {
    while (!calls.some((c) => c.startsWith('set'))) await new Promise(setImmediate)
  }

  const useApi = (url: string) => {
    api = url
  }

  return {
    config,
    file,
    legacy,
    items,
    calls,
    tokens,
    onDisk,
    release,
    keychainWriteStarted,
    useApi,
    api: () => api,
  }
}

test('a sign-in keeps the token in the keychain and only names it in the file', async () => {
  const h = await harness()

  await h.config.write({ token: 'tok-1', userInfo: USER })

  assert.equal(h.items.get(ACCOUNT), 'tok-1')
  assert.deepEqual(await h.onDisk(), { keychainAccount: ACCOUNT, userInfo: USER, apiUrl: API })
  assert.equal((await fs.stat(h.file)).mode & 0o777, 0o600)
  assert.deepEqual(h.tokens, ['tok-1'])
  assert.equal((await h.config.read()).token, 'tok-1')
})

test('a plaintext token from an older client moves to the keychain', async () => {
  const h = await harness()

  await fs.writeFile(h.file, yaml.dump({ token: 'tok-old', userInfo: USER }))

  assert.equal((await h.config.read()).token, 'tok-old')
  assert.equal(h.items.get(ACCOUNT), 'tok-old')
  assert.deepEqual(await h.onDisk(), { keychainAccount: ACCOUNT, userInfo: USER, apiUrl: API })
})

test('signing out while a plaintext token moves to the keychain stays signed out', async () => {
  const h = await harness({ gated: true })

  await fs.writeFile(h.file, yaml.dump({ token: 'tok-old', userInfo: USER }))
  const reading = h.config.read()

  await h.keychainWriteStarted()
  const signingOut = h.config.write({})

  h.release()
  await Promise.all([reading, signingOut])

  assert.equal(h.items.size, 0)
  assert.deepEqual(await h.onDisk(), {})
  assert.equal(h.tokens.at(-1), null)
  assert.equal((await h.config.read()).token, undefined)
})

test('a newer sign-in while a plaintext token moves to the keychain wins, keeping both', async () => {
  const h = await harness({ gated: true })
  const other = { ...USER, id: 'u9' }

  await fs.writeFile(h.file, yaml.dump({ token: 'tok-old', userInfo: USER }))
  const reading = h.config.read()

  await h.keychainWriteStarted()
  const signingIn = h.config.write({ token: 'tok-9', userInfo: other })

  h.release()
  await Promise.all([reading, signingIn])

  assert.deepEqual(Object.fromEntries(h.items), {
    [ACCOUNT]: 'tok-old',
    'u9@https://api.nuphos.ai': 'tok-9',
  })
  assert.equal(h.tokens.at(-1), 'tok-9')
  assert.equal((await h.config.read()).token, 'tok-9')
})

test('signing out while the CLI sign-in is adopted stays signed out', async () => {
  const h = await harness({ gated: true })

  await fs.writeFile(h.legacy, yaml.dump({ token: 'tok-cli', userInfo: USER }))
  const reading = h.config.read()

  await h.keychainWriteStarted()
  const signingOut = h.config.write({})

  h.release()
  await Promise.all([reading, signingOut])

  assert.equal(h.items.size, 0)
  assert.deepEqual(await h.onDisk(), {})
  assert.equal(h.tokens.at(-1), null)
  assert.equal((await h.config.read()).token, undefined)
})

test('signing out removes the keychain item and empties the file', async () => {
  const h = await harness()

  await h.config.write({ token: 'tok-1', userInfo: USER })
  await h.config.write({})

  assert.equal(h.items.size, 0)
  assert.deepEqual(await h.onDisk(), {})
  assert.deepEqual(h.tokens, ['tok-1', null, null])
  assert.equal((await h.config.read()).token, undefined)
})

test('a missing keychain item reads as signed out, keeping the identity', async () => {
  const h = await harness()

  await fs.writeFile(h.file, yaml.dump({ keychainAccount: ACCOUNT, userInfo: USER }))

  assert.deepEqual(await h.config.read(), { keychainAccount: ACCOUNT, userInfo: USER })
})

test('without a keychain the token stays in the file', async () => {
  const h = await harness({ secure: false })

  await h.config.write({ token: 'tok-1', userInfo: USER })

  assert.deepEqual(await h.onDisk(), { token: 'tok-1', userInfo: USER, apiUrl: API })
  assert.deepEqual(h.calls, [])
  assert.equal((await h.config.read()).token, 'tok-1')
})

test('a keychain that refuses the write leaves the token in the file', async () => {
  const h = await harness({ failSet: true })

  await h.config.write({ token: 'tok-1', userInfo: USER })

  assert.deepEqual(await h.onDisk(), { token: 'tok-1', userInfo: USER, apiUrl: API })
  assert.deepEqual(h.tokens, ['tok-1'])
})

const OTHER: UserInfo = { ...USER, id: 'u9', email: 'other@example.com' }
const OTHER_ACCOUNT = 'u9@https://api.nuphos.ai'

test('signing in as someone else keeps the previous account signed in', async () => {
  const h = await harness()

  await h.config.write({ token: 'tok-1', userInfo: USER })
  await h.config.write({ token: 'tok-9', userInfo: OTHER })

  assert.deepEqual(Object.fromEntries(h.items), { [ACCOUNT]: 'tok-1', [OTHER_ACCOUNT]: 'tok-9' })
  assert.equal((await h.config.read()).token, 'tok-9')
  assert.deepEqual(await h.config.others(), [
    { key: ACCOUNT, user: USER, apiUrl: 'https://api.nuphos.ai' },
  ])
  assert.equal((await h.onDisk()).otherAccounts !== undefined, true)
})

test('switching makes a listed account current without a new sign-in', async () => {
  const h = await harness()

  await h.config.write({ token: 'tok-1', userInfo: USER })
  await h.config.write({ token: 'tok-9', userInfo: OTHER })
  const current = await h.config.switchTo(ACCOUNT)

  assert.equal(current.token, 'tok-1')
  assert.equal(h.tokens.at(-1), 'tok-1')
  assert.equal((await h.config.read()).token, 'tok-1')
  assert.deepEqual(
    (await h.config.others()).map((o) => o.key),
    [OTHER_ACCOUNT],
  )
  assert.equal(h.items.size, 2)
  await assert.rejects(h.config.switchTo('nobody@https://api.nuphos.ai'))
})

test('signing in again to a listed account updates its item in place', async () => {
  const h = await harness()

  await h.config.write({ token: 'tok-1', userInfo: USER })
  await h.config.write({ token: 'tok-9', userInfo: OTHER })
  h.calls.length = 0
  await h.config.write({ token: 'tok-1b', userInfo: USER })

  assert.deepEqual(h.calls, [`set ${ACCOUNT}`])
  assert.equal(h.items.get(ACCOUNT), 'tok-1b')
  assert.deepEqual(
    (await h.config.others()).map((o) => o.key),
    [OTHER_ACCOUNT],
  )
})

test('signing out of the current account leaves the others signed in', async () => {
  const h = await harness()

  await h.config.write({ token: 'tok-1', userInfo: USER })
  await h.config.write({ token: 'tok-9', userInfo: OTHER })
  await h.config.write({})

  assert.deepEqual([...h.items.keys()], [ACCOUNT])
  assert.equal((await h.config.read()).token, undefined)
  assert.deepEqual(
    (await h.config.others()).map((o) => o.key),
    [ACCOUNT],
  )
  assert.equal((await h.config.switchTo(ACCOUNT)).token, 'tok-1')
  assert.deepEqual(await h.config.others(), [])
})

test('signing out of all accounts removes every item', async () => {
  const h = await harness()

  await h.config.write({ token: 'tok-1', userInfo: USER })
  await h.config.write({ token: 'tok-9', userInfo: OTHER })
  await h.config.signOutAll()

  assert.equal(h.items.size, 0)
  assert.deepEqual(await h.onDisk(), {})
  assert.equal(h.tokens.at(-1), null)
})

test('switching to an account on another backend points the app there', async () => {
  const h = await harness()

  h.useApi('https://nuphos.example.com')
  await h.config.write({ token: 'tok-self', userInfo: USER })
  h.useApi('https://api.nuphos.ai')
  await h.config.write({ token: 'tok-9', userInfo: OTHER })

  const [listed] = await h.config.others()

  assert.deepEqual(listed, {
    key: 'u1@https://nuphos.example.com',
    user: USER,
    apiUrl: 'https://nuphos.example.com',
  })
  assert.equal((await h.config.switchTo(listed.key)).token, 'tok-self')
  assert.equal(h.api(), 'https://nuphos.example.com')
  assert.deepEqual(
    (await h.config.others()).map((o) => [o.key, o.apiUrl]),
    [[OTHER_ACCOUNT, 'https://api.nuphos.ai']],
  )
})

test('without a keychain each account keeps its token in the file', async () => {
  const h = await harness({ secure: false })

  await h.config.write({ token: 'tok-1', userInfo: USER })
  await h.config.write({ token: 'tok-9', userInfo: OTHER })

  assert.deepEqual(h.calls, [])
  assert.equal((await h.onDisk()).token, 'tok-9')
  assert.deepEqual(
    (await h.config.others()).map((o) => o.key),
    [ACCOUNT],
  )
  assert.equal((await h.config.switchTo(ACCOUNT)).token, 'tok-1')
  assert.equal((await h.onDisk()).token, 'tok-1')
})

test('the first run starts from the sign-in shared with the CLI, and takes the token out of cli.yaml', async () => {
  const h = await harness()

  await fs.writeFile(h.legacy, yaml.dump({ token: 'tok-old', user: 'Bruce', userInfo: USER }))

  assert.equal((await h.config.read()).token, 'tok-old')
  assert.equal(h.items.get(ACCOUNT), 'tok-old')
  assert.deepEqual(await h.onDisk(), {
    keychainAccount: ACCOUNT,
    user: 'Bruce',
    userInfo: USER,
    apiUrl: API,
  })
  assert.deepEqual(await h.onDisk(h.legacy), { user: 'Bruce', userInfo: USER })
})

test('without a keychain the shared sign-in is copied and the CLI keeps its own', async () => {
  const h = await harness({ secure: false })

  await fs.writeFile(h.legacy, yaml.dump({ token: 'tok-old', userInfo: USER }))

  assert.equal((await h.config.read()).token, 'tok-old')
  assert.deepEqual(await h.onDisk(), { token: 'tok-old', userInfo: USER, apiUrl: API })
  assert.deepEqual(await h.onDisk(h.legacy), { token: 'tok-old', userInfo: USER })
})

test('signing out of the app does not pick the CLI sign-in up again', async () => {
  const h = await harness({ secure: false })

  await fs.writeFile(h.legacy, yaml.dump({ token: 'tok-cli', userInfo: USER }))
  await h.config.read()
  await h.config.write({})

  assert.equal((await h.config.read()).token, undefined)
  assert.equal((await h.onDisk(h.legacy)).token, 'tok-cli')
})

test('an item this app did not make is replaced, not reused', async () => {
  const h = await harness()

  h.items.set(ACCOUNT, 'planted')
  await h.config.write({ token: 'tok-1', userInfo: USER })
  await h.config.write({ token: 'tok-2', userInfo: USER })

  assert.deepEqual(
    h.calls.filter((c) => c.startsWith('delete')),
    [`delete ${ACCOUNT}`],
  )
  assert.equal(h.items.get(ACCOUNT), 'tok-2')
})

test('only the packaged macOS app keeps the token in the keychain', () => {
  const electron = { versions: { ...process.versions, electron: '40.0.0' } }

  assert.equal(secureStorageEnabled('darwin', electron), true)
  assert.equal(secureStorageEnabled('darwin', { ...electron, defaultApp: true }), false)
  assert.equal(secureStorageEnabled('darwin', { versions: process.versions }), false)
  assert.equal(secureStorageEnabled('linux', electron), false)
})
