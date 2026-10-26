import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, mock, test } from 'node:test'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'account-request-'))

process.env.NUPHOS_CLI_CONFIG = path.join(dir, 'cli.yaml')
process.env.NUPHOS_API_URL = 'https://a.example.test'
mock.module('./analytics.ts', { namedExports: { captureMain: () => {} } })
mock.module('./client-version.ts', {
  namedExports: { CLIENT_VERSION_HEADER: 'x-test', CLIENT_VERSION_VALUE: 'test' },
})

const { AccountChangedError, authSession } = await import('./auth-session.ts')
const { call } = await import('./atlas/client.ts')
const { callJson } = await import('./agent/http.ts')

type Pending = { url: string; auth: string; signal: AbortSignal; reply: (body: unknown) => void }
const pending: Pending[] = []

mock.method(globalThis, 'fetch', (url: string, init: RequestInit) => {
  const signal = init.signal as AbortSignal

  return new Promise<Response>((resolve, reject) => {
    signal.addEventListener(
      'abort',
      () => reject(signal.reason instanceof Error ? signal.reason : new Error('aborted')),
      { once: true },
    )
    pending.push({
      url,
      auth: (init.headers as Record<string, string>).authorization,
      signal,
      reply: (body) => resolve(Response.json(body)),
    })
  })
})
after(() => fs.rmSync(dir, { recursive: true, force: true }))

const tick = () => new Promise((resolve) => setImmediate(resolve))

for (const [name, request] of [
  ['atlas', () => call<{ who: string }>('GET', '/me', undefined, { retry: false })],
  ['agent', () => callJson<{ who: string }>('GET', '/me')],
] as const) {
  test(`${name}: a request goes out as one account, URL and token together`, async () => {
    authSession.set('tok-a', 'a')
    const reply = request()

    await tick()
    const req = pending.shift()!

    assert.equal(req.url, 'https://a.example.test/me')
    assert.equal(req.auth, 'Bearer tok-a')
    req.reply({ who: 'a' })
    assert.deepEqual(await reply, { who: 'a' })
  })

  test(`${name}: switching accounts aborts a request in flight instead of showing its reply`, async () => {
    authSession.set('tok-a', 'a')
    const reply = request()

    await tick()
    const req = pending.shift()!

    authSession.set('tok-b', 'b')
    assert.equal(req.signal.aborted, true)
    await assert.rejects(reply, AccountChangedError)
  })

  test(`${name}: a reply that lands as the account signs out is dropped`, async () => {
    authSession.set('tok-a', 'a')
    const reply = request()

    await tick()
    const req = pending.shift()!

    // The response is already in; only reading it is left.
    req.reply({ who: 'a' })
    authSession.set(null, null)
    await assert.rejects(reply, AccountChangedError)
  })
}

test('a new backend never receives the token from the old one', async () => {
  authSession.set('tok-a', 'a')
  authSession.moveTo('https://b.example.test')
  await assert.rejects(call('GET', '/me'), /Not signed in/u)
  assert.equal(pending.length, 0)
})
