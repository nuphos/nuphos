import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import yaml from 'js-yaml'

import { configFile } from './config.ts'

import type { UserInfo } from '../auth-status.ts'
import type { TokenStore } from './token-store.ts'

const USER: UserInfo = { id: 'u1', name: 'Bruce', email: 'bruce@example.com', username: 'bruce' }
const ACCOUNT = 'u1@https://api.nuphos.ai'

async function harness({ secure = true, failSet = false } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nuphos-config-'))
  const file = path.join(dir, 'desktop.yaml')
  const legacy = path.join(dir, 'cli.yaml')
  const items = new Map<string, string>()
  const calls: string[] = []
  const store: TokenStore = {
    get: (account) => {
      calls.push(`get ${account}`)

      return Promise.resolve(items.get(account) ?? null)
    },
    set: (account, token) => {
      calls.push(`set ${account}`)
      if (failSet) return Promise.reject(new Error('locked'))
      items.set(account, token)

      return Promise.resolve()
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
    apiUrl: () => 'https://api.nuphos.ai/',
    onToken: (token) => tokens.push(token),
    legacyPath: legacy,
  })
  const onDisk = async (at = file) =>
    yaml.load(await fs.readFile(at, 'utf8')) as Record<string, unknown>

  return { config, file, legacy, items, calls, tokens, onDisk }
}

test('a sign-in keeps the token in the keychain and only names it in the file', async () => {
  const h = await harness()

  await h.config.write({ token: 'tok-1', userInfo: USER })

  assert.equal(h.items.get(ACCOUNT), 'tok-1')
  assert.deepEqual(await h.onDisk(), { keychainAccount: ACCOUNT, userInfo: USER })
  assert.equal((await fs.stat(h.file)).mode & 0o777, 0o600)
  assert.deepEqual(h.tokens, ['tok-1'])
  assert.equal((await h.config.read()).token, 'tok-1')
})

test('reading again does not reach the keychain while the file is unchanged', async () => {
  const h = await harness()

  await h.config.write({ token: 'tok-1', userInfo: USER })
  h.calls.length = 0
  await h.config.read()
  await h.config.read()
  // Refreshing the cached identity rewrites the file but not the token.
  await h.config.write({ ...(await h.config.read()), user: 'Bruce W.' })

  assert.deepEqual(h.calls, [])
})

test('a token the CLI wrote is picked up once the file changes', async () => {
  const h = await harness()

  await h.config.write({ token: 'tok-1', userInfo: USER })
  await h.config.read()
  h.items.set(ACCOUNT, 'tok-2')
  await fs.writeFile(h.file, yaml.dump({ keychainAccount: ACCOUNT, userInfo: USER, user: 'cli' }))

  assert.equal((await h.config.read()).token, 'tok-2')
})

test('a plaintext token from an older client moves to the keychain', async () => {
  const h = await harness()

  await fs.writeFile(h.file, yaml.dump({ token: 'tok-old', userInfo: USER }))

  assert.equal((await h.config.read()).token, 'tok-old')
  assert.equal(h.items.get(ACCOUNT), 'tok-old')
  assert.deepEqual(await h.onDisk(), { keychainAccount: ACCOUNT, userInfo: USER })
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

  assert.deepEqual(await h.onDisk(), { token: 'tok-1', userInfo: USER })
  assert.deepEqual(h.calls, [])
  assert.equal((await h.config.read()).token, 'tok-1')
})

test('a keychain that refuses the write leaves the token in the file', async () => {
  const h = await harness({ failSet: true })

  await h.config.write({ token: 'tok-1', userInfo: USER })

  assert.deepEqual(await h.onDisk(), { token: 'tok-1', userInfo: USER })
  assert.deepEqual(h.tokens, ['tok-1'])
})

test('another user replaces the previous keychain item', async () => {
  const h = await harness()

  await h.config.write({ token: 'tok-1', userInfo: USER })
  await h.config.write({ token: 'tok-9', userInfo: { ...USER, id: 'u9' } })

  assert.deepEqual([...h.items], [['u9@https://api.nuphos.ai', 'tok-9']])
})

test('the first run starts from the sign-in shared with the CLI, and takes the token out of cli.yaml', async () => {
  const h = await harness()

  await fs.writeFile(h.legacy, yaml.dump({ token: 'tok-old', user: 'Bruce', userInfo: USER }))

  assert.equal((await h.config.read()).token, 'tok-old')
  assert.equal(h.items.get(ACCOUNT), 'tok-old')
  assert.deepEqual(await h.onDisk(), { keychainAccount: ACCOUNT, user: 'Bruce', userInfo: USER })
  assert.deepEqual(await h.onDisk(h.legacy), { user: 'Bruce', userInfo: USER })
})

test('without a keychain the shared sign-in is copied and the CLI keeps its own', async () => {
  const h = await harness({ secure: false })

  await fs.writeFile(h.legacy, yaml.dump({ token: 'tok-old', userInfo: USER }))

  assert.equal((await h.config.read()).token, 'tok-old')
  assert.deepEqual(await h.onDisk(), { token: 'tok-old', userInfo: USER })
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
