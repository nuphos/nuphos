import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

type Handler = (
  event: { sender: unknown; senderFrame: unknown },
  id: unknown,
  waiting: unknown,
) => void
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
  const listeners: (() => void)[] = []
  const add = (_event: string, listener: () => void) => listeners.push(listener)

  return {
    session,
    window: {},
    mainFrame: {},
    listeners,
    getType: () => 'window',
    isDestroyed: () => false,
    send: mock.fn(),
    on: add,
    once: add,
    off: (_event: string, listener: () => void) =>
      listeners.splice(listeners.indexOf(listener) >>> 0, 1),
    ...overrides,
  }
}

watchBrowserPasskeys(session as never)

const report = (
  sender: { mainFrame: unknown },
  id: unknown,
  waiting: boolean,
  senderFrame = sender.mainFrame,
) => {
  handlers[0]({ sender, senderFrame }, id, waiting)
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

test('a sub-frame report shows nothing', () => {
  const before = shown.length

  report(tab(), 1, true, {})
  assert.equal(shown.length, before)
})

test('repeated requests listen for navigation once, and stop when the notice goes', () => {
  const sender = tab()

  for (const id of [1, 2, 3]) report(sender, id, true)
  assert.equal(sender.listeners.length, 1)
  for (const id of [1, 2, 3]) report(sender, id, false)
  assert.equal(sender.listeners.length, 0)
})

test('concurrent requests share one notice until the last ends, and Cancel refuses all', () => {
  const sender = tab()

  close.mock.resetCalls()
  report(sender, 1, true)
  report(sender, 2, true)
  const notice = shown[shown.length - 1]

  report(sender, 2, false)
  assert.equal(close.mock.callCount(), 0)
  assert.equal(notice.onLink('nuphos-notice:cancel'), false)
  assert.deepEqual(
    sender.send.mock.calls.map((call) => call.arguments),
    [['browser-passkey:cancel', 1]],
  )
  assert.equal(close.mock.callCount(), 1)
})
