import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
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

/** What a server answers: a redirect, or a status with headers and body chunks. */
type Answer = {
  status: number
  location?: string
  headers?: Record<string, string | string[]>
  chunks?: Buffer[]
}

/** Every request the Mac's browser session sent, hop by hop, as `net.request` would. */
const sent: { url: string; method: string; headers: Record<string, string>; body: string }[] = []
let server: (url: string) => Answer = (_url) => ({
  status: 200,
  headers: { 'content-type': 'text/html', 'set-cookie': ['sid=secret'] },
  chunks: [Buffer.from('<h1>hi</h1>')],
})
/** How many body chunks the fake response let out before it was stopped. */
let streamed = 0

/** `net.request` as Electron behaves under `redirect: 'manual'`: each hop waits for followRedirect. */
function fakeRequest(options: { url: string; method: string; redirect: string }) {
  const request = new EventEmitter() as EventEmitter & Record<string, unknown>
  const headers: Record<string, string> = {}
  let url = options.url
  let body = ''
  let aborted = false
  const hop = () => {
    const answer = server(url)

    sent.push({ url, method: options.method, headers, body })
    if (answer.location) {
      request.emit('redirect', answer.status, options.method, new URL(answer.location, url).href)

      return
    }
    const response = Object.assign(new EventEmitter(), {
      statusCode: answer.status,
      headers: answer.headers ?? {},
    })

    request.emit('response', response)
    for (const chunk of answer.chunks ?? []) {
      if (aborted) return
      streamed++
      response.emit('data', chunk)
    }
    if (!aborted) response.emit('end')
  }

  assert.equal(options.redirect, 'manual')
  Object.assign(request, {
    setHeader: (name: string, value: string) => {
      headers[name] = value
    },
    write: (chunk: Buffer) => {
      body += chunk.toString()
    },
    end: () => queueMicrotask(hop),
    abort: () => {
      aborted = true
    },
    followRedirect: () => {
      url = new URL(server(url).location ?? '', url).href
      queueMicrotask(hop)
    },
  })

  return request
}

let proxyFetch: typeof ProxyFetch
let isLocalHost: typeof IsLocalHost

before(async () => {
  mock.module('electron', {
    namedExports: {
      BrowserWindow: { getAllWindows: () => [window] },
      net: { request: fakeRequest },
      session: { fromPartition: () => ({}) },
    },
  })
  mock.module('../browser-extensions/manage.ts', { namedExports: { browserSession: () => ({}) } })
  ;({ proxyFetch, isLocalHost } = await import('./dock-proxy.ts'))
})

const call = (fields: Partial<BrowserCall>): BrowserCall => ({
  action: 'fetch',
  team: 't',
  session: 'mine',
  ...fields,
})
const read = (result: Awaited<ReturnType<typeof ProxyFetch>>) =>
  JSON.parse((result.content as { text: string }[])[0]?.text ?? '{}') as {
    status: number
    url: string
    headers: Record<string, string>
    body: string
  }

test("fetches a page at a dock tab's local address, without the Mac's cookies", async () => {
  sent.length = 0
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
  const value = read(result)

  assert.equal(result.isError, undefined)
  assert.equal(sent[0]?.url, 'http://localhost:3000/api?x=1')
  assert.equal(sent[0]?.method, 'POST')
  // Only headers a page needs pass; the Mac's own session brings its cookies, which never come back.
  assert.deepEqual(sent[0]?.headers, { 'Content-Type': 'application/json' })
  assert.equal(sent[0]?.body, '{"a":1}')
  assert.equal(value.status, 200)
  assert.deepEqual(value.headers, { 'content-type': 'text/html' })
  assert.equal(Buffer.from(value.body, 'base64').toString(), '<h1>hi</h1>')
})

test("refuses a public host, another port, a local host no tab is on, and another conversation's", async () => {
  sent.length = 0
  for (const refused of [
    call({ url: 'https://example.com/' }),
    // Another port on the same host: a page fetched this way skips CORS, so only the tab's own.
    call({ url: 'http://localhost:8080/' }),
    call({ url: 'http://192.168.1.9:3000/' }),
    call({ url: 'http://localhost:3000/', session: 'other' }),
    call({ url: 'file:///etc/hosts' }),
  ])
    assert.equal((await proxyFetch(refused)).isError, true, refused.url)
  assert.deepEqual(sent, [])
})

test('a redirect is followed only within the dock, each hop checked before it is sent', async () => {
  server = (url) =>
    url.endsWith('/old')
      ? { status: 307, location: '/new' }
      : url.endsWith('/away')
        ? { status: 302, location: 'http://192.168.1.9/steal' }
        : {
            status: 200,
            headers: { 'content-type': 'text/plain' },
            chunks: [Buffer.from('moved here')],
          }
  sent.length = 0
  const value = read(await proxyFetch(call({ url: 'http://localhost:3000/old' })))

  assert.deepEqual(
    sent.map((request) => request.url),
    ['http://localhost:3000/old', 'http://localhost:3000/new'],
  )
  assert.equal(value.url, 'http://localhost:3000/new')
  assert.equal(Buffer.from(value.body, 'base64').toString(), 'moved here')
  sent.length = 0
  assert.equal((await proxyFetch(call({ url: 'http://localhost:3000/away' }))).isError, true)
  assert.deepEqual(
    sent.map((request) => request.url),
    ['http://localhost:3000/away'],
  )
})

test('a response too large for the tunnel is stopped while it streams, not cut', async () => {
  streamed = 0
  server = () => ({
    status: 200,
    chunks: Array.from({ length: 64 }, () => Buffer.alloc(1024 * 1024)),
  })
  const result = await proxyFetch(call({ url: 'http://localhost:3000/big.js' }))

  assert.equal(result.isError, true)
  // Read only a little past the cap, not the whole 64 MB.
  assert.ok(streamed <= 5, String(streamed))
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
