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
let reply = () =>
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

            return reply()
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

test("fetches a page on a dock tab's local host, any port, without the Mac's cookies", async () => {
  fetched.length = 0
  const result = await proxyFetch(
    call({
      url: 'http://localhost:8080/api?x=1',
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
  assert.equal(fetched[0]?.url, 'http://localhost:8080/api?x=1')
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
    call({ url: 'http://192.168.1.9:3000/' }),
    call({ url: 'http://localhost:3000/', session: 'other' }),
    call({ url: 'file:///etc/hosts' }),
  ])
    assert.equal((await proxyFetch(refused)).isError, true, refused.url)
  assert.deepEqual(fetched, [])
})

test('a response too large for the tunnel is refused, not cut', async () => {
  reply = () => new Response(Buffer.alloc(4 * 1024 * 1024 + 1))
  const result = await proxyFetch(call({ url: 'http://localhost:3000/big.js' }))

  assert.equal(result.isError, true)
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
