import assert from 'node:assert/strict'
import test from 'node:test'

import { escapeLeavesView } from './escapeToExit.ts'

import type { EscapeContext } from './escapeToExit.ts'

const base: EscapeContext = {
  key: 'Escape',
  handled: false,
  overlayOpen: false,
  inField: false,
  inView: false,
  inOtherView: false,
  paneActive: true,
}

test('with two detail panes, one Escape exits only the pane that owns focus', () => {
  const event = { handled: false }
  const panes = [
    { inView: true, paneActive: true },
    { inView: false, inOtherView: true, paneActive: false },
  ]
  const exited = panes.map((pane) => {
    const leaves = escapeLeavesView({ ...base, ...pane, handled: event.handled })

    if (leaves) event.handled = true

    return leaves
  })

  assert.deepEqual(exited, [true, false])
})

test('an already handled Escape does not exit a second pane', () => {
  assert.equal(escapeLeavesView({ ...base, inView: true, handled: true }), false)
})

test('an inactive pane ignores Escape pressed elsewhere', () => {
  assert.equal(escapeLeavesView({ ...base, paneActive: false }), false)
  assert.equal(escapeLeavesView({ ...base, inOtherView: true, paneActive: false }), false)
})

test('the active pane exits when focus is outside any detail view', () => {
  assert.equal(escapeLeavesView({ ...base, paneActive: true }), true)
  assert.equal(escapeLeavesView({ ...base, inOtherView: true, paneActive: true }), false)
})

test('dialogs, menus and text fields keep Escape', () => {
  assert.equal(escapeLeavesView({ ...base, inView: true, overlayOpen: true }), false)
  assert.equal(escapeLeavesView({ ...base, inView: true, inField: true }), false)
  assert.equal(escapeLeavesView({ ...base, key: 'Enter', inView: true }), false)
})
