import assert from 'node:assert/strict'
import test from 'node:test'

import { raiseWindow } from './window-raise.ts'

import type { RaisableWindow } from './window-raise.ts'

function fakeWindow(state: {
  destroyed?: boolean
  minimized?: boolean
  visible?: boolean
}): RaisableWindow & { calls: string[] } {
  const calls: string[] = []

  return {
    calls,
    isDestroyed: () => state.destroyed === true,
    isMinimized: () => state.minimized === true,
    isVisible: () => state.visible !== false,
    restore: () => {
      calls.push('restore')
      state.minimized = false
      state.visible = true
    },
    show: () => {
      calls.push('show')
      state.visible = true
    },
    focus: () => {
      calls.push('focus')
    },
  }
}

test('a minimized window is restored before it is focused', () => {
  const win = fakeWindow({ minimized: true, visible: false })

  assert.equal(raiseWindow(win), true)
  assert.deepEqual(win.calls, ['restore', 'focus'])
})

test('a hidden window is shown', () => {
  const win = fakeWindow({ visible: false })

  assert.equal(raiseWindow(win), true)
  assert.deepEqual(win.calls, ['show', 'focus'])
})

test('a visible window is only focused', () => {
  const win = fakeWindow({})

  assert.equal(raiseWindow(win), true)
  assert.deepEqual(win.calls, ['focus'])
})

test('a destroyed or missing window is not touched', () => {
  const win = fakeWindow({ destroyed: true })

  assert.equal(raiseWindow(win), false)
  assert.deepEqual(win.calls, [])
  assert.equal(raiseWindow(null), false)
  assert.equal(raiseWindow(undefined), false)
})
