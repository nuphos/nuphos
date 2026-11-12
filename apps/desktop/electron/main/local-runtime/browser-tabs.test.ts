import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { before, mock, test } from 'node:test'

import type { BrowserCall } from './browser-stream.ts'
import type { runBrowserCall as RunBrowserCall } from './browser-tabs.ts'

const app = new EventEmitter()
const browserSession = {}
/** window-session.ts's flag: set by before-quit, and by an update restart before it. */
let appQuitting = false
const windows: Window[] = []
let runBrowserCall: typeof RunBrowserCall

let nextId = 1

/** A tab's page, which loads whatever it is asked to and finishes when a test says so. */
class Page extends EventEmitter {
  readonly id = nextId++
  url = ''
  loading = false
  throttled = true
  /** Whether the page was painting freely when it was captured. */
  throttledAtCapture: boolean | undefined
  /** What the page's script resolves to; never settles unless a test says so. */
  script = new Promise<unknown>(() => {})
  readonly session: unknown
  constructor(session: unknown) {
    super()
    this.session = session
  }
  isDestroyed = () => false
  getURL = () => this.url
  getTitle = () => ''
  isLoading = () => this.loading
  executeJavaScript = () => this.script
  getBackgroundThrottling = () => this.throttled
  setBackgroundThrottling = (throttled: boolean) => {
    this.throttled = throttled
  }
  capturePage = () => {
    this.throttledAtCapture = this.throttled

    return Promise.resolve({ isEmpty: () => false, toJPEG: () => Buffer.from('jpeg') })
  }
  loadURL = (url: string) => {
    this.url = url
    this.loading = true

    return new Promise<void>(() => {})
  }
  finish(): void {
    this.loading = false
    this.emit('did-stop-loading')
  }
}

class Window extends EventEmitter {
  static readonly getAllWindows = () => windows
  visible = false
  destroyed = false
  readonly options: Record<string, unknown> & { webPreferences: { session: unknown } }
  readonly webContents: Page
  constructor(options: Window['options']) {
    super()
    this.options = options
    this.webContents = new Page(options.webPreferences.session)
    this.visible = options.show !== false
    if (typeof options.opacity === 'number') this.opacity = options.opacity
    windows.push(this)
  }
  setTitle() {}
  isDestroyed = () => this.destroyed
  isMinimized = () => false
  restore() {}
  isVisible = () => this.visible
  show() {
    this.visible = true
  }
  hide() {
    this.visible = false
  }
  focus() {}
  opacity = 1
  setOpacity(opacity: number) {
    this.opacity = opacity
  }
  showInactive() {
    this.shownOnce = true
  }
  shownOnce = false
  /** The user's close button: the window decides whether it goes. */
  close() {
    let prevented = false

    this.emit('close', {
      preventDefault: () => {
        prevented = true
      },
    })
    if (!prevented) this.destroy()
  }
  destroy() {
    this.destroyed = true
    this.emit('closed')
  }
}

before(async () => {
  mock.module('electron', {
    namedExports: {
      app,
      BrowserWindow: Window,
      ipcMain: { on: () => {} },
      net: { request: () => ({}) },
      session: { fromPartition: () => browserSession },
      webContents: { getAllWebContents: () => [] },
    },
  })
  mock.module('../browser-extensions/host.ts', { namedExports: { extensionHost: () => null } })
  mock.module('../browser-extensions/manage.ts', {
    namedExports: { browserSession: () => browserSession },
  })
  mock.module('../window-session.ts', { namedExports: { isAppQuitting: () => appQuitting } })
  ;({ runBrowserCall } = await import('./browser-tabs.ts'))
})

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

function textOf(result: Awaited<ReturnType<typeof RunBrowserCall>>): string {
  const [part] = result.content as { text: string }[]

  return part?.text ?? ''
}

/** A tab `session` opened through `open`, loaded and idle, with its window. */
async function opened(session = 's1', url = 'https://example.com/start') {
  const result = runBrowserCall({ action: 'open', team: 't1', session, url })
  const window = windows.at(-1)
  const page = window?.webContents

  assert.ok(window && page)
  await tick()
  page.finish()
  await result

  return { window, page }
}

/** The tab ids `session` lists. */
const listed = (session: string) =>
  runBrowserCall({ action: 'tabs', team: 't1', session }).then((result) =>
    (JSON.parse(textOf(result)) as { tab: number }[]).map((tab) => tab.tab),
  )

test("open loads the page in a hidden desktop-sized window on the user's browser session", async () => {
  let done = false
  const result = runBrowserCall({
    action: 'open',
    team: 't1',
    session: 's1',
    url: 'https://example.com',
  })
  const window = windows.at(-1)

  void result.then(() => {
    done = true
  })
  assert.ok(window)
  assert.equal(window.visible, false)
  assert.equal(window.options.enableLargerThanScreen, true)
  assert.deepEqual([window.options.width, window.options.height], [1440, 900])
  assert.equal(window.webContents.session, browserSession)
  assert.equal(window.webContents.url, 'https://example.com')
  // Its first paint shows it once, unseen, then hides it, so the page can be captured yet sleeps.
  assert.equal(window.opacity, 0)
  window.emit('ready-to-show')
  assert.deepEqual([window.shownOnce, window.visible, window.opacity], [true, false, 1])
  await tick()
  assert.equal(done, false, 'the page is still loading')

  window.webContents.finish()
  assert.equal((JSON.parse(textOf(await result)) as { tab: number }).tab, window.webContents.id)
})

test('a conversation sees and drives only the tabs it opened', async () => {
  const mine = await opened('own-a', 'https://example.com/mine')
  const theirs = await opened('own-b', 'https://example.com/theirs')

  assert.deepEqual(await listed('own-a'), [mine.page.id])
  assert.deepEqual(await listed('own-b'), [theirs.page.id])
  const result = await runBrowserCall({
    action: 'eval',
    team: 't1',
    session: 'own-a',
    tab: theirs.page.id,
    script: '1',
  })

  assert.equal(result.isError, true)
})

test('a call without a conversation is refused before it touches any tab', async () => {
  const { page } = await opened()
  const call = { action: 'eval', team: 't1', tab: page.id, script: '1' } as unknown as BrowserCall

  assert.equal((await runBrowserCall(call)).isError, true)
})

test('show puts the tab on screen, and closing its window hides it again', async () => {
  const { window, page } = await opened('show-1')

  await runBrowserCall({ action: 'show', team: 't1', session: 'show-1', tab: page.id })
  assert.equal(window.visible, true)
  window.close()
  assert.equal(window.visible, false)
  assert.equal(window.destroyed, false)
  assert.deepEqual(await listed('show-1'), [page.id])
})

test('an update restart closes a hidden tab, so the app can quit and install', async () => {
  const { window } = await opened('update-1')

  // quitAndInstall closes every window before before-quit fires; only the
  // app's own flag, set first by installUpdate, says the app is going.
  appQuitting = true
  try {
    window.close()
  } finally {
    appQuitting = false
  }
  assert.equal(window.destroyed, true)
})

test('close ends the tab', async () => {
  const { window, page } = await opened('close-1')

  await runBrowserCall({ action: 'close', team: 't1', session: 'close-1', tab: page.id })
  assert.equal(window.destroyed, true)
  assert.deepEqual(await listed('close-1'), [])
})

test('a screenshot lets the hidden page paint freely only while it is captured', async () => {
  const { page } = await opened('shot-1')
  const result = await runBrowserCall({
    action: 'screenshot',
    team: 't1',
    session: 'shot-1',
    tab: page.id,
  })

  assert.equal(result.isError, undefined)
  assert.equal(page.throttledAtCapture, false)
  assert.equal(page.throttled, true)
})

test('eval settles when its script navigates the tab to a new document', async () => {
  const { page } = await opened()
  const result = runBrowserCall({
    action: 'eval',
    team: 't1',
    session: 's1',
    tab: page.id,
    script: 'click()',
  })

  await tick()
  page.emit('did-start-navigation', {
    url: 'https://example.com/edit',
    isMainFrame: true,
    isSameDocument: false,
  })
  // The stream turns a rejected call into an error result for the agent.
  await assert.rejects(result, /navigated to https:\/\/example\.com\/edit/)
})

test('eval keeps waiting through a client-side route change', async () => {
  const { page } = await opened()

  page.script = new Promise((resolve) => setTimeout(resolve, 10, 'edit page'))
  const result = runBrowserCall({
    action: 'eval',
    team: 't1',
    session: 's1',
    tab: page.id,
    script: 'route()',
  })

  page.emit('did-start-navigation', {
    url: 'https://example.com/edit',
    isMainFrame: true,
    isSameDocument: true,
  })
  assert.equal(textOf(await result), 'edit page')
})

test('eval fails after the call timeout when the page never answers', async (t) => {
  const { page } = await opened()

  t.mock.timers.enable({ apis: ['setTimeout'] })
  const result = runBrowserCall({
    action: 'eval',
    team: 't1',
    session: 's1',
    tab: page.id,
    script: 'hang()',
  })

  t.mock.timers.tick(30_000)
  await assert.rejects(result, /did not finish within 30s/)
})
