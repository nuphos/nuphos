import assert from 'node:assert/strict'
import { test } from 'node:test'

import { homeVisible, panelVisible } from './panelVisibility.ts'

test('a page is on screen unless its host covers it; a panel only when opened', () => {
  assert.equal(panelVisible('page', undefined), true)
  assert.equal(panelVisible('page', true), true)
  assert.equal(panelVisible('page', false), false)
  assert.equal(panelVisible('panel', undefined), false)
  assert.equal(panelVisible('panel', true), true)
})

test('the home counts as shown only on an on-screen panel without a conversation', () => {
  assert.equal(homeVisible(true, false), true)
  assert.equal(homeVisible(true, true), false)
  assert.equal(homeVisible(false, false), false)
})
