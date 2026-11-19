import assert from 'node:assert/strict'
import test from 'node:test'

import { readLoginItem, writeLoginItem } from './login-item.ts'

import type { LoginItemApp } from './login-item.ts'

function fakeApp({ isPackaged = true } = {}) {
  const writes: { openAtLogin: boolean }[] = []
  let openAtLogin = false
  const app: LoginItemApp = {
    isPackaged,
    getLoginItemSettings: () => ({ openAtLogin }),
    setLoginItemSettings: (settings) => {
      writes.push(settings)
      openAtLogin = settings.openAtLogin
    },
  }

  return { app, writes }
}

test('a release on macOS or Windows offers the login item', () => {
  assert.deepEqual(readLoginItem(fakeApp().app, 'darwin'), { supported: true, openAtLogin: false })
  assert.deepEqual(readLoginItem(fakeApp().app, 'win32'), { supported: true, openAtLogin: false })
})

test('Linux and unpackaged builds do not, and refuse to write one', () => {
  for (const [app, platform] of [
    [fakeApp().app, 'linux'],
    [fakeApp({ isPackaged: false }).app, 'darwin'],
  ] as const) {
    assert.deepEqual(readLoginItem(app, platform), { supported: false, openAtLogin: false })
    assert.throws(() => writeLoginItem(app, platform, true), /not available/u)
  }
})

test('turning it on and off writes the OS login item and reads it back', () => {
  const { app, writes } = fakeApp()

  assert.deepEqual(writeLoginItem(app, 'win32', true), { supported: true, openAtLogin: true })
  assert.deepEqual(writeLoginItem(app, 'win32', false), { supported: true, openAtLogin: false })
  assert.deepEqual(writes, [{ openAtLogin: true }, { openAtLogin: false }])
})

test('only a boolean is written', () => {
  const { app, writes } = fakeApp()

  assert.throws(() => writeLoginItem(app, 'darwin', 'yes'), /true or false/u)
  assert.deepEqual(writes, [])
})
