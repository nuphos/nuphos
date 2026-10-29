import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, mock, test } from 'node:test'

// A process whose session nothing has set yet: the token is still on disk, as
// at Desktop launch before `auth:status`, or in the `nuphos agent` host.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'account-request-startup-'))

process.env.NUPHOS_CLI_CONFIG = path.join(dir, 'cli.yaml')
process.env.NUPHOS_API_URL = 'https://a.example.test'
fs.writeFileSync(path.join(dir, 'desktop.yaml'), 'token: tok-disk\n')
mock.module('./analytics.ts', { namedExports: { captureMain: () => {} } })
mock.module('./client-version.ts', {
  namedExports: { CLIENT_VERSION_HEADER: 'x-test', CLIENT_VERSION_VALUE: 'test' },
})

const { AccountChangedError, authSession } = await import('./auth-session.ts')
const { call } = await import('./atlas/client.ts')
const { callJson, setTokenSource } = await import('./agent/http.ts')

type Pending = { auth: string; reply: (body: unknown) => void }
const pending: Pending[] = []

mock.method(globalThis, 'fetch', (_url: string, init: RequestInit) => {
  const signal = init.signal as AbortSignal

  return new Promise<Response>((resolve, reject) => {
    signal.addEventListener(
      'abort',
      () => reject(signal.reason instanceof Error ? signal.reason : new Error('aborted')),
      { once: true },
    )
    pending.push({
      auth: (init.headers as Record<string, string>).authorization,
      reply: (body) => resolve(Response.json(body)),
    })
  })
})
after(() => fs.rmSync(dir, { recursive: true, force: true }))

// Reading the token from disk takes real I/O, so wait for the request itself.
const sent = async (): Promise<Pending> => {
  for (let i = 0; i < 500 && pending.length === 0; i++)
    await new Promise((resolve) => setTimeout(resolve, 2))

  return pending.shift()!
}

// Before any test below sets the session.
test('a token from setTokenSource, never in the session, is not mistaken for another account', async () => {
  setTokenSource(() => Promise.resolve('tok-cli'))
  const reply = callJson<{ ok: boolean }>('PUT', '/agent/devices')

  const req = await sent()

  assert.equal(req.auth, 'Bearer tok-cli')
  req.reply({ ok: true })
  assert.deepEqual(await reply, { ok: true })
})

test('a request that finishes before the startup check uses the token on disk', async () => {
  const reply = call<{ who: string }>('GET', '/me', undefined, { retry: false })

  const req = await sent()

  assert.equal(req.auth, 'Bearer tok-disk')
  req.reply({ who: 'disk' })
  assert.deepEqual(await reply, { who: 'disk' })
})

test('the startup check confirming the same token does not cut off a request', async () => {
  const reply = call<{ who: string }>('GET', '/me', undefined, { retry: false })

  const req = await sent()

  authSession.set('tok-disk', 'u1')
  req.reply({ who: 'disk' })
  assert.deepEqual(await reply, { who: 'disk' })
})

test('after the check, signing out still ends a request', async () => {
  const reply = call('GET', '/me', undefined, { retry: false })

  await sent()
  authSession.set(null, null)
  await assert.rejects(reply, AccountChangedError)
})
