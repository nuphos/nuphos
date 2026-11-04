import assert from 'node:assert/strict'
import { before, mock, test } from 'node:test'

import type { BrowserCall } from './browser-stream.ts'
import type { isLocalHost as IsLocalHost, proxyFetch as ProxyFetch } from './dock-proxy.ts'

/** The conversation's dock in the one window: a local dev page and a public one. */
const tabs = [
  {
    id: 'dev',
    kind: 'team.browser',
    title: 'Preview app',
    href: '/teams/t/browser',
    url: 'http://localhost:3000/',
  },
  {
    id: 'pub',
    kind: 'team.browser',
    title: 'Example',
    href: '/teams/t/browser',
    url: 'https://example.com/',
  },
]
const window = {
  isDestroyed: () => false,
  webContents: {
    executeJavaScript: async (script: string) =>
      script.includes('"mine"')
        ? { tabs, activeTabId: 'dev', recent: [] }
        : { tabs: [], activeTabId: null, recent: [] },
  },
}
/** What the Mac's browser session was asked to fetch. */
const fetched: { url: string; init: RequestInit }[] = []
let reply = (_url: string): Response =>
  new Response('<h1>hi</h1>', {
    status: 200,
    headers: { 'content-type': 'text/html', 'set-cookie': 'sid=secret' },
  })
let proxyFetch: typeof ProxyFetch
let isLocalHost: typeof IsLocalHost

before(async () => {
  mock.module('electron', {
    namedExports: {
      BrowserWindow: { getAllWindows: () => [window] },
      session: {
        fromPartition: () => ({
          fetch: async (url: string, init: RequestInit) => {
            fetched.push({ url, init })

            return reply(url)
          },
        }),
      },
    },
  })
  ;({ proxyFetch, isLocalHost } = await import('./dock-proxy.ts'))
})

const call = (fields: Partial<BrowserCall>): BrowserCall => ({
  action: 'fetch',
  team: 't',
  session: 'mine',
  ...fields,
})

test("fetches a page at a dock tab's local address, without the Mac's cookies", async () => {
  fetched.length = 0
  const result = await proxyFetch(
    call({
      url: 'http://localhost:3000/api?x=1',
      method: 'post',
      headers: {
        'Content-Type': 'application/json',
        Cookie: 'from-phone',
        Authorization: 'Bearer x',
      },
      body: Buffer.from('{"a":1}').toString('base64'),
    }),
  )
  const value = JSON.parse((result.content as { text: string }[])[0]?.text ?? '{}') as {
    status: number
    headers: Record<string, string>
    body: string
  }

  assert.equal(result.isError, undefined)
  assert.equal(fetched[0]?.url, 'http://localhost:3000/api?x=1')
  assert.equal(fetched[0]?.init.redirect, 'manual')
  assert.equal(fetched[0]?.init.method, 'POST')
  // Only headers a page needs pass; the Mac's own session brings its cookies, which never come back.
  assert.deepEqual(fetched[0]?.init.headers, { 'Content-Type': 'application/json' })
  assert.equal(Buffer.from(fetched[0]?.init.body as Buffer).toString(), '{"a":1}')
  assert.equal(value.status, 200)
  assert.deepEqual(value.headers, { 'content-type': 'text/html' })
  assert.equal(Buffer.from(value.body, 'base64').toString(), '<h1>hi</h1>')
})

test("refuses a public host, a local host no dock tab is on, and another conversation's", async () => {
  fetched.length = 0
  for (const refused of [
    call({ url: 'https://example.com/' }),
    // Another port on the same host: a page fetched this way skips CORS, so only the tab's own.
    call({ url: 'http://localhost:8080/' }),
    call({ url: 'http://192.168.1.9:3000/' }),
    call({ url: 'http://localhost:3000/', session: 'other' }),
    call({ url: 'file:///etc/hosts' }),
  ])
    assert.equal((await proxyFetch(refused)).isError, true, refused.url)
  assert.deepEqual(fetched, [])
})

test('a redirect is followed only within the dock, each hop checked', async () => {
  fetched.length = 0
  reply = (url) =>
    url.endsWith('/old')
      ? new Response(null, { status: 302, headers: { location: '/new' } })
      : url.endsWith('/away')
        ? new Response(null, { status: 302, headers: { location: 'http://192.168.1.9/steal' } })
        : new Response('moved here', { status: 200, headers: { 'content-type': 'text/plain' } })
  const followed = await proxyFetch(call({ url: 'http://localhost:3000/old' }))
  const value = JSON.parse((followed.content as { text: string }[])[0]?.text ?? '{}') as {
    url: string
    body: string
  }

  assert.deepEqual(
    fetched.map((request) => request.url),
    ['http://localhost:3000/old', 'http://localhost:3000/new'],
  )
  assert.equal(value.url, 'http://localhost:3000/new')
  assert.equal(Buffer.from(value.body, 'base64').toString(), 'moved here')
  fetched.length = 0
  assert.equal((await proxyFetch(call({ url: 'http://localhost:3000/away' }))).isError, true)
  assert.deepEqual(
    fetched.map((request) => request.url),
    ['http://localhost:3000/away'],
  )
})

test('a response too large for the tunnel is stopped while it streams, not cut', async () => {
  let pulled = 0

  reply = () =>
    new Response(
      new ReadableStream({
        pull(controller) {
          pulled++
          controller.enqueue(new Uint8Array(1024 * 1024))
        },
      }),
    )
  const result = await proxyFetch(call({ url: 'http://localhost:3000/big.js' }))

  assert.equal(result.isError, true)
  // An endless body is read only a little past the cap.
  assert.ok(pulled < 10, String(pulled))
})

test('local hosts: loopback, .local and private ranges only', () => {
  /* eslint-disable sonarjs/no-hardcoded-ip -- host classification fixture; no network request */
  for (const host of [
    'localhost',
    '127.0.0.1',
    '[::1]',
    'mac.local',
    '10.0.0.2',
    '172.16.0.1',
    '192.168.1.20',
  ])
    assert.equal(isLocalHost(host), true, host)
  for (const host of ['example.com', '172.32.0.1', '8.8.8.8', '999.1.1.1'])
    assert.equal(isLocalHost(host), false, host)
  /* eslint-enable sonarjs/no-hardcoded-ip */
})
