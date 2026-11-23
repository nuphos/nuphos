import assert from 'node:assert/strict'
import { test } from 'node:test'

import { homeVisible, panelVisible } from './panelVisibility.ts'

function entrances(frames: boolean[]): number {
  return frames.filter((shown, index) => shown && index > 0 && !frames[index - 1]).length
}

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

test('the home entrance replays however it comes back into view', () => {
  const fromConversation = [homeVisible(true, true), homeVisible(true, false)]
  const fromManagementPage = [homeVisible(false, false), homeVisible(true, false)]
  const fromManagementPageOverAChat = [homeVisible(false, true), homeVisible(true, false)]

  assert.equal(entrances(fromConversation), 1)
  assert.equal(entrances(fromManagementPage), 1)
  assert.equal(entrances(fromManagementPageOverAChat), 1)
})
