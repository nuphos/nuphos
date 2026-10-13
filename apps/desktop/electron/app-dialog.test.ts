import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { before, beforeEach, mock, test } from 'node:test'

import { appDialogHtml } from './app-dialog-html.ts'

class FakeWindow extends EventEmitter {
  static readonly windows: FakeWindow[] = []
  webContents = Object.assign(new EventEmitter(), {
    mainFrame: {},
    setWindowOpenHandler: () => {},
  })
  destroyed = false
  readonly options: Record<string, unknown>
  constructor(options: Record<string, unknown> = {}) {
    super()
    this.options = options
    FakeWindow.windows.push(this)
  }
  isDestroyed() {
    return this.destroyed
  }
  destroy() {
    this.destroyed = true
    this.emit('closed')
  }
  show() {}
  loadURL() {
    return Promise.resolve()
  }
}
let showAppDialog: typeof import('./app-dialog.ts').showAppDialog

before(async () => {
  mock.module('electron', { namedExports: { BrowserWindow: FakeWindow } })
  ;({ showAppDialog } = await import('./app-dialog.ts'))
})
beforeEach(() => {
  FakeWindow.windows.length = 0
})
const opts = { title: 'Approve', message: 'Proceed?', confirmLabel: 'Confirm' }

function navigate(win: FakeWindow, url: string, initiator = win.webContents.mainFrame) {
  let prevented = false

  win.webContents.emit('will-navigate', {
    url,
    initiator,
    preventDefault: () => {
      prevented = true
    },
  })
  assert.equal(prevented, true)
}

test('untrusted text cannot inject markup or a confirmation action', () => {
  const html = appDialogHtml({
    title: '<script>evil()</script>',
    message: '<form action="https://nuphos-dialog.invalid/confirm">',
    detail: '&secret',
    confirmLabel: '<img>',
  })

  assert.ok(!html.includes('<script>'))
  assert.ok(html.includes('&lt;form'))
  assert.ok(html.includes('&amp;secret'))
  assert.ok(html.includes('<button autofocus>Cancel</button>'))
  assert.ok(html.includes("default-src 'none'"))
})

test('only the isolated document can confirm; no renderer preload or scripts', async () => {
  const result = showAppDialog(null, opts)
  const win = FakeWindow.windows[0]
  const prefs = win.options.webPreferences as Record<string, unknown>

  assert.equal(prefs.sandbox, true)
  assert.equal(prefs.javascript, false)
  assert.equal(prefs.nodeIntegration, false)
  assert.equal(prefs.preload, undefined)
  navigate(win, 'https://nuphos-dialog.invalid/confirm', {})
  assert.equal(win.destroyed, false)
  navigate(win, 'https://attacker.example/confirm')
  assert.equal(win.destroyed, false)
  navigate(win, 'https://nuphos-dialog.invalid/confirm?')
  assert.equal(await result, true)
})

test('closing or Escape cancels and never authorizes', async () => {
  const closed = showAppDialog(null, opts)

  FakeWindow.windows[0].destroy()
  assert.equal(await closed, false)
  const escaped = showAppDialog(null, opts)

  FakeWindow.windows[1].webContents.emit(
    'before-input-event',
    { preventDefault() {} },
    { key: 'Escape' },
  )
  assert.equal(await escaped, false)
})

test('parent destruction cancels; separate requests never share approval', async () => {
  const parent = new FakeWindow()
  const a = showAppDialog(parent as never, opts)
  const b = showAppDialog(parent as never, opts)

  navigate(FakeWindow.windows[1], 'https://nuphos-dialog.invalid/confirm')
  assert.equal(await a, true)
  assert.equal(FakeWindow.windows[2].destroyed, false)
  parent.destroy()
  assert.equal(await b, false)
  assert.equal(parent.listenerCount('closed'), 0)
})

test('an informational dialog cannot approve an action', async () => {
  const result = showAppDialog(null, { title: 'Update', message: 'Ready' })
  const win = FakeWindow.windows[0]

  navigate(win, 'https://nuphos-dialog.invalid/confirm')
  assert.equal(win.destroyed, false)
  navigate(win, 'https://nuphos-dialog.invalid/cancel')
  assert.equal(await result, false)
})
