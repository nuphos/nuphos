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
}
const externalUrls: string[] = []

before(async () => {
  mock.module('electron', {
    namedExports: {
      app,
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

function guest(browser: boolean) {
  let open: (details: { url: string }) => { action: string } = ({ url }) => {
    throw new Error(`Missing popup handler for ${url}`)
  }
  const loaded: string[] = []
  const contents = Object.assign(new EventEmitter(), {
    session: browser ? browserSession : {},
    getType: () => 'webview',
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

  return { contents, loaded, open: (url: string) => open({ url }) }
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
