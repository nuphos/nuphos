import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, mock, test } from 'node:test'

import yaml from 'js-yaml'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-backend-'))
const desktopFile = path.join(dir, 'desktop.yaml')

process.env.NUPHOS_CLI_CONFIG = path.join(dir, 'cli.yaml')
process.env.NUPHOS_API_URL = 'https://a.example.test'
mock.module('electron', {
  namedExports: { app: { getVersion: () => '0.0.0-test' }, shell: { openExternal: () => {} } },
})

const ended: { url: string; authorization: string | null }[] = []

mock.method(globalThis, 'fetch', (url: string, init: RequestInit) => {
  ended.push({ url, authorization: new Headers(init.headers).get('authorization') })

  return Promise.resolve(new Response(null, { status: 204 }))
})
after(() => fs.rmSync(dir, { recursive: true, force: true }))

const { changeBackend } = await import('./auth.ts')
const { authSession } = await import('./auth-session.ts')

test('a new backend sets the sign-in aside, on disk too, so no launch sends it to the new one', async () => {
  fs.writeFileSync(desktopFile, yaml.dump({ token: 'tok-a', userInfo: { id: 'u1' } }))
  authSession.set('tok-a', 'u1')

  assert.equal(await changeBackend('https://b.example.test'), 'https://b.example.test')
  assert.equal(authSession.current(), null)
  // Still signed in on the backend that issued it, waiting to be switched back to.
  assert.deepEqual(yaml.load(fs.readFileSync(desktopFile, 'utf8')), {
    accounts: [{ api: 'https://a.example.test', token: 'tok-a', userInfo: { id: 'u1' } }],
  })
  assert.deepEqual(ended, [], 'the session is not ended on its backend')
})

test('the same backend again keeps the sign-in', async () => {
  fs.writeFileSync(desktopFile, yaml.dump({ token: 'tok-b', userInfo: { id: 'u1' } }))
  authSession.set('tok-b', 'u1')
  ended.length = 0

  assert.equal(await changeBackend('https://b.example.test/'), 'https://b.example.test')
  assert.equal(authSession.current(), 'tok-b')
  assert.equal(
    (yaml.load(fs.readFileSync(desktopFile, 'utf8')) as { token?: string }).token,
    'tok-b',
  )
  assert.deepEqual(ended, [])
})

test('switching to an account on another backend moves backend and token in one step', async () => {
  const { switchAccount, signOutAccount } = await import('./auth.ts')
  const { writeConfig } = await import('./auth/config.ts')

  // u1 waits on a.example.test (set aside above); u2 signs in on b.example.test.
  fs.writeFileSync(
    desktopFile,
    yaml.dump({
      accounts: [{ api: 'https://a.example.test', token: 'tok-a', userInfo: { id: 'u1' } }],
    }),
  )
  await writeConfig({ token: 'tok-b2', userInfo: { id: 'u2', name: '', email: '', username: '' } })
  const seen: { api: string; token: string | null }[] = []
  const stop = authSession.subscribe(({ api, token }) => seen.push({ api, token }))

  await switchAccount('u1@https://a.example.test')
  stop()
  assert.deepEqual(seen, [{ api: 'https://a.example.test', token: 'tok-a' }])
  assert.equal(
    fs.readFileSync(path.join(dir, 'cli.api-url'), 'utf8').trim(),
    'https://a.example.test',
  )

  ended.length = 0
  await signOutAccount('u2@https://b.example.test')
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(ended, [
    { url: 'https://b.example.test/auth/sessions/current', authorization: 'Bearer tok-b2' },
  ])
  assert.equal(authSession.current(), 'tok-a', 'the active account is untouched')
})
