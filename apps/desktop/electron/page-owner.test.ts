import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'

import { onPageGone } from './page-owner.ts'

import type { WebContents } from 'electron'

const PAGE_EVENTS = ['destroyed', 'render-process-gone', 'did-start-navigation']

function page() {
  const emitter = new EventEmitter()

  return {
    emitter,
    owner: emitter as unknown as WebContents,
    listeners: () => PAGE_EVENTS.reduce((n, event) => n + emitter.listenerCount(event), 0),
  }
}

test('a reload releases once and leaves no listener behind', () => {
  const { emitter, owner, listeners } = page()
  let released = 0

  onPageGone(owner, () => released++)
  emitter.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
  emitter.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
  assert.equal(released, 1)
  assert.equal(listeners(), 0)
})

test('in-page and subframe navigations keep the page', () => {
  const { emitter, owner, listeners } = page()
  let released = 0

  onPageGone(owner, () => released++)
  emitter.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true })
  emitter.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false })
  assert.equal(released, 0)
  assert.equal(listeners(), 3)
})

test('a crash or a closed window releases', () => {
  for (const event of ['render-process-gone', 'destroyed']) {
    const { emitter, owner, listeners } = page()
    let released = 0

    onPageGone(owner, () => released++)
    emitter.emit(event)
    assert.equal(released, 1, event)
    assert.equal(listeners(), 0, event)
  }
})

test('many subscriptions on one page share one listener set', () => {
  const { emitter, owner, listeners } = page()
  let released = 0
  const offs = Array.from({ length: 12 }, () => onPageGone(owner, () => released++))

  // Past EventEmitter's default of 10 per event, Node warns of a leak.
  assert.equal(listeners(), PAGE_EVENTS.length)
  offs[0]?.()
  offs[1]?.()
  emitter.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
  assert.equal(released, 10)
  assert.equal(listeners(), 0)
})

test('the page keeps its listeners until its last subscription unregisters', () => {
  const { owner, listeners } = page()
  let released = 0
  const first = onPageGone(owner, () => released++)
  const second = onPageGone(owner, () => released++)

  first()
  first()
  assert.equal(listeners(), PAGE_EVENTS.length)
  second()
  assert.equal(listeners(), 0)
  assert.equal(released, 0)
})

test('unregistering removes every listener without releasing', () => {
  const { emitter, owner, listeners } = page()
  let released = 0
  const off = onPageGone(owner, () => released++)

  off()
  emitter.emit('destroyed')
  assert.equal(released, 0)
  assert.equal(listeners(), 0)
})
