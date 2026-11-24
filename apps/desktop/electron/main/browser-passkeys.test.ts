import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

type Handler = (event: { sender: unknown }, id: unknown, waiting: unknown) => void
type Notice = { onLink: (url: string) => boolean }

const handlers: Handler[] = []
const shown: Notice[] = []
const close = mock.fn()

mock.module('electron', {
  namedExports: {
    ipcMain: {
      on: (_channel: string, listener: Handler) => {
        handlers.push(listener)
      },
    },
    BrowserWindow: { fromWebContents: (contents: { window?: unknown }) => contents.window ?? null },
  },
})
mock.module('./local-runtime/window-notice.ts', {
  namedExports: {
    escapeHtml: (text: string) => text,
    showWindowNotice: (_window: unknown, _html: string, options: Notice) => {
      shown.push(options)

      return close
    },
  },
})

const { watchBrowserPasskeys } = await import('./browser-passkeys.ts')
const session = {}

function tab(overrides: Record<string, unknown> = {}) {
  return {
    session,
    window: {},
    getType: () => 'window',
    isDestroyed: () => false,
    send: mock.fn(),
    once: mock.fn(),
    ...overrides,
  }
}

watchBrowserPasskeys(session as never)

const report = (sender: unknown, id: unknown, waiting: boolean) => {
  handlers[0]({ sender }, id, waiting)
}

test('a waiting tab shows the notice, and Cancel refuses that request in the page', () => {
  const sender = tab()

  report(sender, 7, true)
  assert.equal(shown.length, 1)
  assert.equal(shown[0].onLink('nuphos-notice:cancel'), false)
  assert.deepEqual(sender.send.mock.calls[0].arguments, ['browser-passkey:cancel', 7])
  assert.equal(shown[0].onLink('nuphos-notice:close'), false)
  assert.equal(sender.send.mock.callCount(), 1)
})

test('the notice goes when its request ends, not when another one does', () => {
  const sender = tab()

  close.mock.resetCalls()
  report(sender, 3, true)
  report(sender, 2, false)
  assert.equal(close.mock.callCount(), 0)
  report(sender, 3, false)
  assert.equal(close.mock.callCount(), 1)
})

test('other sessions, Dock guests and malformed reports show nothing', () => {
  const before = shown.length

  report(tab({ session: {} }), 1, true)
  report(tab({ getType: () => 'webview' }), 1, true)
  report(tab(), '1', true)
  assert.equal(shown.length, before)
})
