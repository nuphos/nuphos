import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, beforeEach, mock, test } from 'node:test'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'conditional-get-'))

process.env.NUPHOS_CLI_CONFIG = path.join(dir, 'cli.yaml')
process.env.NUPHOS_API_URL = 'https://a.example.test'
mock.module('./analytics.ts', { namedExports: { captureMain: () => {} } })
mock.module('./client-version.ts', {
  namedExports: { CLIENT_VERSION_HEADER: 'x-test', CLIENT_VERSION_VALUE: 'test' },
})

const { authSession } = await import('./auth-session.ts')
const { call } = await import('./atlas/client.ts')
const { callJson } = await import('./agent/http.ts')
const { clearConditionalGets } = await import('./conditional-get.ts')

type Seen = { method: string; ifNoneMatch?: string }

// A backend with one list: tagged by version, 304 when the tag matches.
const server = {
  plans: ['a'],
  version: 1,
  tagged: true,
  noStore: false,
  wrong304: false,
  seen: [] as Seen[],
}

mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
  const headers = init.headers as Record<string, string>
  const etag = `W/"v${String(server.version)}"`

  server.seen.push({ method: init.method ?? 'GET', ifNoneMatch: headers['if-none-match'] })
  if (server.wrong304 && headers['if-none-match']) {
    return new Response(null, { status: 304, headers: { etag: 'W/"someone-else"' } })
  }
  if (server.tagged && headers['if-none-match'] === etag) {
    return new Response(null, { status: 304, headers: { etag } })
  }
  const cacheControl: Record<string, string> = server.noStore ? { 'cache-control': 'no-store' } : {}

  return Response.json(
    { plans: server.plans },
    { headers: server.tagged ? { etag, ...cacheControl } : cacheControl },
  )
})
after(() => fs.rmSync(dir, { recursive: true, force: true }))
beforeEach(() => {
  clearConditionalGets()
  Object.assign(server, {
    plans: ['a'],
    version: 1,
    tagged: true,
    noStore: false,
    wrong304: false,
    seen: [],
  })
  authSession.set('tok-a', 'a')
})

for (const [name, get, post] of [
  [
    'atlas',
    () => call<{ plans: string[] }>('GET', '/plans', undefined, { retry: false }),
    () => call('POST', '/plans', {}, { retry: false }),
  ],
  [
    'agent',
    () => callJson<{ plans: string[] }>('GET', '/plans'),
    () => callJson('POST', '/plans', {}),
  ],
] as const) {
  test(`${name}: an unchanged GET revalidates and returns the stored body on 304`, async () => {
    assert.deepEqual(await get(), { plans: ['a'] })
    assert.deepEqual(await get(), { plans: ['a'] })
    assert.deepEqual(
      server.seen.map((s) => s.ifNoneMatch),
      [undefined, 'W/"v1"'],
    )
  })

  test(`${name}: a changed list comes back in full and replaces the stored tag`, async () => {
    await get()
    Object.assign(server, { plans: ['a', 'b'], version: 2 })
    assert.deepEqual(await get(), { plans: ['a', 'b'] })
    assert.deepEqual(await get(), { plans: ['a', 'b'] })
    assert.deepEqual(
      server.seen.map((s) => s.ifNoneMatch),
      [undefined, 'W/"v1"', 'W/"v2"'],
    )
  })

  test(`${name}: each 304 hands out its own copy of the stored body`, async () => {
    const first = await get()

    first.plans.push('mutated')
    assert.deepEqual(await get(), { plans: ['a'] })
  })

  test(`${name}: non-GET requests never send If-None-Match`, async () => {
    await get()
    await post()
    assert.equal(server.seen[1]?.method, 'POST')
    assert.equal(server.seen[1]?.ifNoneMatch, undefined)
  })

  test(`${name}: an untagged response is not stored`, async () => {
    server.tagged = false
    await get()
    await get()
    assert.deepEqual(
      server.seen.map((s) => s.ifNoneMatch),
      [undefined, undefined],
    )
  })

  test(`${name}: another account never revalidates the previous account's body`, async () => {
    await get()
    authSession.set('tok-b', 'b')
    await get()
    assert.deepEqual(
      server.seen.map((s) => s.ifNoneMatch),
      [undefined, undefined],
    )
  })

  test(`${name}: a no-store response is never stored`, async () => {
    server.noStore = true
    await get()
    await get()
    assert.deepEqual(
      server.seen.map((s) => s.ifNoneMatch),
      [undefined, undefined],
    )
  })

  test(`${name}: a 304 for a different tag does not reuse the stored body`, async () => {
    await get()
    server.wrong304 = true
    await assert.rejects(get())
    server.wrong304 = false
    assert.deepEqual(await get(), { plans: ['a'] })
    assert.deepEqual(
      server.seen.map((s) => s.ifNoneMatch),
      [undefined, 'W/"v1"', undefined],
    )
  })
}
