import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { before, beforeEach, mock, test } from 'node:test'

class FakeNotification extends EventEmitter {
  static readonly shown: FakeNotification[] = []
  static readonly isSupported = () => true
  readonly options: { title: string; body: string }
  constructor(options: { title: string; body: string }) {
    super()
    this.options = options
  }
  show() {
    FakeNotification.shown.push(this)
  }
}
const win = (focused: boolean) => ({ isFocused: () => focused, webContents: {} })
const windows: ReturnType<typeof win>[] = []
let account = 'jeun'
const opened: string[] = []
const switchedTo: string[] = []
let notifyComputerShared: typeof import('./notify.ts').notifyComputerShared

before(async () => {
  mock.module('electron', {
    namedExports: {
      BrowserWindow: { getAllWindows: () => windows },
      Notification: FakeNotification,
    },
  })
  mock.module('../auth-session.ts', { namedExports: { authSession: { context: () => account } } })
  mock.module('../main/account-leave-core.ts', { namedExports: { accountOf: (a: string) => a } })
  mock.module('../main/account-for-link.ts', {
    namedExports: {
      openAsAccount: async (owner: string, open: () => Promise<void>) => {
        switchedTo.push(owner)
        await open()
      },
    },
  })
  mock.module('../main/deep-links.ts', {
    namedExports: { openAppPath: async (path: string) => void opened.push(path) },
  })
  mock.module('../window-raise.ts', { namedExports: { raiseWindow: () => true } })
  ;({ notifyComputerShared } = await import('./notify.ts'))
})
beforeEach(() => {
  FakeNotification.shown.length = 0
  opened.length = 0
  switchedTo.length = 0
  account = 'jeun'
  windows.length = 0
})

const share = (
  key: string,
  parentWindow: ReturnType<typeof win>,
  title = 'Mac is now shared with you',
  body = 'Your Bots and tasks can run on it now.',
) =>
  notifyComputerShared({
    key,
    title,
    body,
    teamId: 'team-a',
    parentWindow: parentWindow as never,
  })

test('only a focused asking window shows the toast; behind another window it notifies', () => {
  const typingHere = win(true)
  const behind = win(false)

  windows.push(typingHere, behind)
  assert.equal(share('jeun:team-a:mac:use', typingHere), 'in-app')
  assert.equal(share('jeun:team-a:box:use', behind), 'notification')
  assert.equal(FakeNotification.shown.length, 1)
  assert.equal(share('jeun:team-a:box:use', typingHere), 'duplicate')
  // Another account in the same team still hears of it.
  assert.equal(share('maya:team-a:box:use', typingHere), 'in-app')
})

test('a click opens the notice’s team, as the account it was raised for', async () => {
  share('jeun:team-a:pc:use', win(false))
  account = 'other'
  FakeNotification.shown[0].emit('click')
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(switchedTo, ['jeun'])
  assert.deepEqual(opened, ['/teams/team-a/agents'])
})

test('a notice the renderer could not have written is cut short or refused', () => {
  share('jeun:team-a:long:use', win(false), 'T'.repeat(5000), 'B'.repeat(5000))
  const { title, body } = FakeNotification.shown[0].options

  assert.equal(title.length, 200)
  assert.equal(body.length, 400)
  assert.ok(title.endsWith('…'))
  assert.throws(() => share('k'.repeat(257), win(false)), RangeError)
  assert.equal(FakeNotification.shown.length, 1)
})

test('only the latest 500 notices are remembered', () => {
  const here = win(true)

  assert.equal(share('jeun:team-b:first:use', here), 'in-app')
  for (let i = 0; i < 500; i++) share(`jeun:team-b:pc-${String(i)}:use`, here)
  assert.equal(share('jeun:team-b:pc-499:use', here), 'duplicate')
  // The oldest one was let go, so it would be announced again.
  assert.equal(share('jeun:team-b:first:use', here), 'in-app')
})
