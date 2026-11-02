import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { before, mock, test } from 'node:test'

const app = new EventEmitter()
const browserSession = {
  setPermissionCheckHandler: mock.fn<(handler: (...args: unknown[]) => boolean) => void>(),
  setPermissionRequestHandler:
    mock.fn<
      (
        handler: (
          contents: unknown,
          permission: string,
          callback: (allowed: boolean) => void,
        ) => void,
      ) => void
    >(),
  setDevicePermissionHandler: mock.fn<(handler: (...args: unknown[]) => boolean) => void>(),
  getUserAgent: () =>
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Nuphos/0.98.0 Chrome/146.0.7680.65 Electron/43.8.3 Safari/537.36',
  setUserAgent: mock.fn<(userAgent: string) => void>(),
}
const externalUrls: string[] = []

before(async () => {
  mock.module('electron', {
    namedExports: {
      app,
      BrowserWindow: { fromWebContents: () => null },
      session: { fromPartition: () => browserSession },
      shell: {
        openExternal: async (url: string) => {
          externalUrls.push(url)
        },
      },
    },
  })
  const { initWebviewGuard } = await import('./webview-guard.ts')

  initWebviewGuard()
})

function host() {
  const contents = Object.assign(new EventEmitter(), { getType: () => 'window' })

  app.emit('web-contents-created', {}, contents)

  return contents
}

type OpenDetails = { url: string; disposition: string }
type OpenResult = {
  action: string
  overrideBrowserWindowOptions?: { webPreferences?: Record<string, boolean> }
}

function guest(browser: boolean, type = 'webview') {
  let open: (details: OpenDetails) => OpenResult = ({ url }) => {
    throw new Error(`Missing popup handler for ${url}`)
  }
  const loaded: string[] = []
  const contents = Object.assign(new EventEmitter(), {
    session: browser ? browserSession : {},
    getType: () => type,
    // The initial document may still be blank; classification must not use its URL.
    getURL: () => 'about:blank',
    loadURL: async (url: string) => {
      loaded.push(url)
    },
    setWindowOpenHandler: (handler: typeof open) => {
      open = handler
    },
  })

  app.emit('web-contents-created', {}, contents)

  return {
    contents,
    loaded,
    open: (url: string, disposition = 'foreground-tab') => open({ url, disposition }),
  }
}

test('only the browser partition accepts arbitrary HTTP pages and every guest is hardened', () => {
  const contents = host()

  for (const [src, partition, allowed] of [
    ['https://example.com', 'persist:browser', true],
    ['http://localhost:3000', 'persist:browser', true],
    ['file:///etc/passwd', 'persist:browser', false],
    ['https://example.com', '', false],
    ['https://nuphos.ai/changelog/entry', '', true],
  ] as const) {
    const preventDefault = mock.fn()
    const preferences = {
      preload: '/untrusted.js',
      nodeIntegration: true,
      sandbox: false,
      contextIsolation: false,
    }

    contents.emit('will-attach-webview', { preventDefault }, preferences, { src, partition })
    assert.equal(preventDefault.mock.callCount(), allowed ? 0 : 1)
    if (allowed) {
      assert.equal('preload' in preferences, false)
      assert.equal(preferences.nodeIntegration, false)
      assert.equal(preferences.sandbox, true)
      assert.equal(preferences.contextIsolation, true)
    }
  }
})

test('browser redirects stay in-app while privileged schemes remain blocked', () => {
  const { contents, open, loaded } = guest(true)

  for (const eventName of ['will-navigate', 'will-redirect']) {
    const allowed = mock.fn()
    const denied = mock.fn()

    contents.emit(eventName, { preventDefault: allowed }, 'https://example.com')
    contents.emit(eventName, { preventDefault: denied }, 'file:///etc/passwd')
    assert.equal(allowed.mock.callCount(), 0)
    assert.equal(denied.mock.callCount(), 1)
  }
  assert.deepEqual(open('https://example.com/popup'), { action: 'deny' })
  open('file:///etc/passwd')
  assert.deepEqual(loaded, ['https://example.com/popup'])
})

test('changelog redirects and popups still open externally, including before the first load', () => {
  const { contents, open, loaded } = guest(false)
  const preventDefault = mock.fn()

  contents.emit('will-redirect', { preventDefault }, 'https://example.com/reader-link')
  assert.equal(preventDefault.mock.callCount(), 1)
  open('https://example.com/reader-popup')
  assert.deepEqual(loaded, [])
  assert.deepEqual(externalUrls, [
    'https://example.com/reader-link',
    'https://example.com/reader-popup',
  ])
})

test('browser denies permission checks, requests, and persisted device grants', () => {
  const check = browserSession.setPermissionCheckHandler.mock.calls[0].arguments[0]
  const request = browserSession.setPermissionRequestHandler.mock.calls[0].arguments[0]
  const device = browserSession.setDevicePermissionHandler.mock.calls[0].arguments[0]

  for (const permission of [
    'media',
    'display-capture',
    'geolocation',
    'notifications',
    'clipboard-read',
    'fileSystem',
    'unknown',
  ]) {
    assert.equal(check(null, permission, 'https://example.com', { isMainFrame: false }), false)
    const callback = mock.fn()

    request({}, permission, callback)
    assert.deepEqual(callback.mock.calls[0].arguments, [false])
  }
  assert.equal(device({ origin: 'https://example.com', deviceType: 'usb' }), false)
})

test('browser user agent drops the release-specific app and Electron tokens', () => {
  assert.deepEqual(browserSession.setUserAgent.mock.calls[0].arguments, [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.7680.65 Safari/537.36',
  ])
})

test('sign-in popups open as real windows that keep their opener; links still load in the tab', () => {
  const { open, loaded } = guest(true)

  for (const [url, disposition] of [
    // window.open with features, as Google, Apple and Microsoft sign-in call it.
    ['https://accounts.google.com/gsi/transform', 'new-window'],
    ['https://example.com/oauth/authorize', 'new-window'],
    // Known sign-in pages keep their opener even when opened without features.
    ['https://accounts.google.com/o/oauth2/v2/auth', 'foreground-tab'],
    ['https://appleid.apple.com/auth/authorize', 'foreground-tab'],
    ['https://login.microsoftonline.com/common/oauth2/v2.0/authorize', 'foreground-tab'],
    ['https://github.com/login/oauth/authorize', 'foreground-tab'],
  ] as const) {
    const result = open(url, disposition)

    assert.equal(result.action, 'allow', url)
    assert.deepEqual(result.overrideBrowserWindowOptions?.webPreferences, {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    })
  }
  assert.deepEqual(loaded, [])

  // target=_blank links and non-HTTP popups keep today's behaviour.
  assert.deepEqual(open('https://github.com/nuphos/nuphos', 'foreground-tab'), { action: 'deny' })
  assert.deepEqual(open('https://example.com/docs', 'background-tab'), { action: 'deny' })
  assert.deepEqual(open('file:///etc/passwd', 'new-window'), { action: 'deny' })
  assert.deepEqual(loaded, ['https://github.com/nuphos/nuphos', 'https://example.com/docs'])
})

test('a browser popup window gets the same guard, and closes with the tab that opened it', () => {
  const popupWindow = guest(true, 'window')
  const preventDefault = mock.fn()

  popupWindow.contents.emit('will-navigate', { preventDefault }, 'file:///etc/passwd')
  assert.equal(preventDefault.mock.callCount(), 1)
  assert.equal(popupWindow.open('https://appleid.apple.com/auth/authorize').action, 'allow')

  const { contents } = guest(true)
  const close = mock.fn()

  contents.emit('did-create-window', { isDestroyed: () => false, close })
  assert.equal(close.mock.callCount(), 0)
  contents.emit('destroyed')
  assert.equal(close.mock.callCount(), 1)
})

test('changelog popups still open externally, with or without window features', () => {
  const { open, loaded } = guest(false)

  assert.deepEqual(open('https://accounts.google.com/gsi/transform', 'new-window'), {
    action: 'deny',
  })
  assert.deepEqual(loaded, [])
  assert.equal(externalUrls.at(-1), 'https://accounts.google.com/gsi/transform')
})
