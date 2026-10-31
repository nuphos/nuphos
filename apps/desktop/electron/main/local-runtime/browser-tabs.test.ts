import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { before, mock, test } from 'node:test'

import type { BrowserCall } from './browser-stream.ts'
import type { runBrowserCall as RunBrowserCall } from './browser-tabs.ts'

const app = new EventEmitter()
const browserSession = {}
const guests: Guest[] = []
const window = {
  sent: [] as unknown[][],
  isDestroyed: () => false,
  isMinimized: () => false,
  restore: () => {},
  isVisible: () => true,
  show: () => {},
  focus: () => {},
  webContents: { send: (...args: unknown[]) => window.sent.push(args) },
}
let onDeepLink: (url: string) => void = () => {}
let runBrowserCall: typeof RunBrowserCall

before(async () => {
  mock.module('electron', {
    namedExports: {
      app,
      BrowserWindow: { fromWebContents: (host: unknown) => (host ? window : null) },
      session: { fromPartition: () => browserSession },
      webContents: { getAllWebContents: () => guests },
    },
  })
  mock.module('../deep-links.ts', {
    namedExports: { handleDeepLink: (url: string) => onDeepLink(url) },
  })
  ;({ runBrowserCall } = await import('./browser-tabs.ts'))
})

let nextId = 1

/** A browser guest that starts idle on its blank initial document. */
class Guest extends EventEmitter {
  readonly id = nextId++
  readonly session = browserSession
  url = ''
  loading = false
  hostWebContents: object | null = {}
  getType = () => 'webview'
  isDestroyed = () => false
  getURL = () => this.url
  getTitle = () => ''
  isLoading = () => this.loading
  /** What the page's script resolves to; never settles unless a test says so. */
  script = new Promise<unknown>(() => {})
  executeJavaScript = () => this.script

  attach(): this {
    guests.push(this)
    app.emit('web-contents-created', {}, this)

    return this
  }

  navigate(url: string): this {
    this.loading = true
    this.emit('did-start-navigation', { url, isMainFrame: true })

    return this
  }

  finish(): void {
    this.url = this.url || 'loaded'
    this.loading = false
    this.emit('did-stop-loading')
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

function tabOf(result: Awaited<ReturnType<typeof RunBrowserCall>>): number {
  const [part] = result.content as { text: string }[]

  return (JSON.parse(part?.text ?? '{}') as { tab: number }).tab
}

test('open waits for the new tab to load the requested page, not for its creation', async () => {
  let guest: Guest | undefined

  onDeepLink = () => {
    guest = new Guest().attach()
  }
  let done = false
  const result = runBrowserCall({
    action: 'open',
    team: 't1',
    session: 's1',
    url: 'https://example.com',
  })

  void result.then(() => {
    done = true
  })
  await tick()
  assert.ok(guest)
  assert.equal(done, false, 'an idle guest is not the opened page yet')

  guest.navigate('https://example.com/')
  await tick()
  assert.equal(done, false, 'the page is still loading')

  guest.finish()
  assert.equal(tabOf(await result), guest.id)
})

test('open ignores a guest another window attaches for a different page', async () => {
  let mine: Guest | undefined

  onDeepLink = () => {
    new Guest().attach().navigate('https://other.example/').finish()
    mine = new Guest().attach()
  }
  const result = runBrowserCall({
    action: 'open',
    team: 't1',
    session: 's1',
    url: 'https://example.com/a',
  })

  await tick()
  assert.ok(mine)
  mine.navigate('https://example.com/a').finish()
  assert.equal(tabOf(await result), mine.id)
})

test('overlapping opens of the same page each get their own tab', async () => {
  const created: Guest[] = []

  onDeepLink = () => {
    created.push(new Guest().attach())
  }
  const first = runBrowserCall({
    action: 'open',
    team: 't1',
    session: 's1',
    url: 'https://example.com/same',
  })
  const second = runBrowserCall({
    action: 'open',
    team: 't1',
    session: 's1',
    url: 'https://example.com/same',
  })

  await tick()
  for (const guest of created) guest.navigate('https://example.com/same')
  for (const guest of created) guest.finish()

  const tabs = [tabOf(await first), tabOf(await second)]

  assert.deepEqual(
    tabs.toSorted((a, b) => a - b),
    created.map((guest) => guest.id),
  )
})

/** A tab `session` opened through `open`, loaded and idle. */
async function opened(session = 's1', url = 'https://example.com/start'): Promise<Guest> {
  let guest: Guest | undefined

  onDeepLink = () => {
    guest = new Guest().attach()
  }
  const result = runBrowserCall({ action: 'open', team: 't1', session, url })

  await tick()
  assert.ok(guest)
  guest.navigate(url).finish()
  await result

  return guest
}

test('open asks the workspace to show the tab in the calling conversation', async () => {
  let link = ''

  onDeepLink = (url) => {
    link = url
    new Guest().attach().navigate('https://example.com/mine').finish()
  }
  await runBrowserCall({
    action: 'open',
    team: 't1',
    session: 's9',
    url: 'https://example.com/mine',
  })
  assert.equal(new URL(link).searchParams.get('session'), 's9')
})

/** The tab ids `session` lists. */
const listed = (session: string) =>
  runBrowserCall({ action: 'tabs', team: 't1', session }).then((result) =>
    (JSON.parse(textOf(result)) as { tab: number }[]).map((tab) => tab.tab),
  )

test('a conversation sees and drives only the tabs it opened', async () => {
  const mine = await opened('own-a', 'https://example.com/mine')
  const theirs = await opened('own-b', 'https://example.com/theirs')
  const manual = new Guest().attach()

  assert.deepEqual(await listed('own-a'), [mine.id])
  assert.deepEqual(await listed('own-b'), [theirs.id])
  for (const tab of [theirs.id, manual.id]) {
    const result = await runBrowserCall({
      action: 'eval',
      team: 't1',
      session: 'own-a',
      tab,
      script: '1',
    })

    assert.equal(result.isError, true)
  }
})

test('a call without a conversation is refused before it touches any tab', async () => {
  const stray = new Guest().attach()
  const call = { action: 'eval', team: 't1', tab: stray.id, script: '1' } as unknown as BrowserCall

  assert.equal((await runBrowserCall(call)).isError, true)
})

function textOf(result: Awaited<ReturnType<typeof RunBrowserCall>>): string {
  const [part] = result.content as { text: string }[]

  return part?.text ?? ''
}

test('eval settles when its script navigates the tab to a new document', async () => {
  const guest = await opened()
  const result = runBrowserCall({
    action: 'eval',
    team: 't1',
    session: 's1',
    tab: guest.id,
    script: 'click()',
  })

  await tick()
  guest.emit('did-start-navigation', {
    url: 'https://example.com/edit',
    isMainFrame: true,
    isSameDocument: false,
  })
  // The stream turns a rejected call into an error result for the agent.
  await assert.rejects(result, /navigated to https:\/\/example\.com\/edit/)
})

test('eval keeps waiting through a client-side route change', async () => {
  const guest = await opened()

  guest.script = new Promise((resolve) => setTimeout(resolve, 10, 'edit page'))
  const result = runBrowserCall({
    action: 'eval',
    team: 't1',
    session: 's1',
    tab: guest.id,
    script: 'route()',
  })

  guest.emit('did-start-navigation', {
    url: 'https://example.com/edit',
    isMainFrame: true,
    isSameDocument: true,
  })
  assert.equal(textOf(await result), 'edit page')
})

test('eval fails after the call timeout when the page never answers', async (t) => {
  const guest = await opened()

  t.mock.timers.enable({ apis: ['setTimeout'] })
  const result = runBrowserCall({
    action: 'eval',
    team: 't1',
    session: 's1',
    tab: guest.id,
    script: 'hang()',
  })

  t.mock.timers.tick(30_000)
  await assert.rejects(result, /did not finish within 30s/)
})

test('focus raises the window and names the tab to its renderer, only for its own conversation', async () => {
  let guest: Guest | undefined

  onDeepLink = () => {
    guest = new Guest().attach()
  }
  const opening = runBrowserCall({
    action: 'open',
    team: 't',
    session: 'mine',
    url: 'https://a.test/',
  })

  await tick()
  guest?.navigate('https://a.test/').finish()
  const tab = tabOf(await opening)

  window.sent = []
  const call = (session: string): BrowserCall => ({ action: 'focus', team: 't', session, tab })

  assert.equal((await runBrowserCall(call('other'))).isError, true)
  assert.deepEqual(window.sent, [])
  assert.equal((await runBrowserCall(call('mine'))).isError, undefined)
  assert.deepEqual(window.sent, [
    ['agent:focus-session', { sessionId: 'mine', teamId: 't', browserTab: tab }],
  ])
})
