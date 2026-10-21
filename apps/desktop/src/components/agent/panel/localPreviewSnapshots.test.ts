import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createLocalPreviewSnapshots } from './localPreviewSnapshots.ts'

const scope = { userId: 'viewer', teamId: 'example-team' }
const href = 'http://localhost:5173/preview'
const value = { title: 'Example preview', image: 'data:image/jpeg;base64,aW1hZ2U=' }

test('page snapshots are isolated by user, team and exact local page', () => {
  const store = createLocalPreviewSnapshots()

  assert.equal(store.publish(Symbol('fixture owner'), scope, href, value), true)
  assert.equal(store.get(scope, href), value)
  assert.equal(store.get({ ...scope, userId: 'another-viewer' }, href), undefined)
  assert.equal(store.get({ ...scope, teamId: 'another-team' }, href), undefined)
  assert.equal(store.get(scope, `${href}?different=1`), undefined)
  assert.equal(store.get(undefined, href), undefined)
})

test('remote URLs, credentials and remote image sources cannot enter the snapshot cache', () => {
  const store = createLocalPreviewSnapshots()

  for (const url of [
    'https://example.com',
    'http://user:password@localhost:5173',
    'blob:http://localhost:5173/page',
  ])
    assert.equal(store.publish(Symbol('fixture owner'), scope, url, value), false)
  for (const image of [
    'https://example.com/image.jpg',
    'data:image/svg+xml,<svg/>',
    `data:image/jpeg;base64,${'a'.repeat(512 * 1024)}`,
  ])
    assert.equal(store.publish(Symbol('fixture owner'), scope, href, { ...value, image }), false)
  assert.equal(store.get(scope, href), undefined)
})

test('closing an older tab cannot clear a newer tab’s snapshot for the same URL', () => {
  const store = createLocalPreviewSnapshots()
  const older = Symbol('fixture owner')
  const newer = Symbol('fixture owner')

  store.publish(older, scope, href, value)
  store.publish(newer, scope, href, { ...value, title: 'Newer page' })
  store.clear(older)
  assert.equal(store.get(scope, href)?.title, 'Newer page')
  store.clear(newer)
  assert.equal(store.get(scope, href), undefined)
})

test('a tab owns one page and the cache bounds the total number of images', () => {
  const store = createLocalPreviewSnapshots()
  const owner = Symbol('fixture owner')

  store.publish(owner, scope, href, value)
  store.publish(owner, scope, `${href}/next`, value)
  assert.equal(store.get(scope, href), undefined)
  for (let i = 0; i < 13; i += 1)
    store.publish(Symbol('fixture owner'), scope, `${href}?page=${i}`, value)
  assert.equal(store.get(scope, `${href}/next`), undefined)
  assert.equal(store.get(scope, `${href}?page=0`), undefined)
  assert.equal(store.get(scope, `${href}?page=12`), value)
})

test('literal terminal punctuation in paths and query values never aliases another page', () => {
  const store = createLocalPreviewSnapshots()

  for (const suffix of ['.', '?value=a!', '?value=a']) {
    store.publish(Symbol('punctuation page'), scope, href + suffix, { ...value, title: suffix })
  }
  assert.equal(store.get(scope, href), undefined)
  for (const suffix of ['.', '?value=a!', '?value=a'])
    assert.equal(store.get(scope, href + suffix)?.title, suffix)
})
