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

test('a new backend ends the sign-in there, on disk too, so no launch sends it to the new one', async () => {
  fs.writeFileSync(desktopFile, yaml.dump({ token: 'tok-a', userInfo: { id: 'u1' } }))
  authSession.set('tok-a', 'u1')

  assert.equal(await changeBackend('https://b.example.test'), 'https://b.example.test')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(authSession.current(), null)
  assert.deepEqual(yaml.load(fs.readFileSync(desktopFile, 'utf8')) ?? {}, {})
  assert.deepEqual(ended, [
    { url: 'https://a.example.test/auth/sessions/current', authorization: 'Bearer tok-a' },
  ])
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
