import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  REVEAL_LIFETIME_MS,
  openChatSummaryChanges,
  openChatSummarySubAgents,
  setChangesFilter,
  PRIMARY_PANE_ID,
  setChatSummaryOpen,
  setSubAgentsFilter,
  takeChangesReveal,
  takeSubAgentsReveal,
} from './chatSummaryPanel.ts'

test('opening on Changes asks that chat for one reveal, even with the same filter again', () => {
  openChatSummaryChanges('merged', 'a')
  assert.equal(takeChangesReveal('a'), true)
  assert.equal(takeChangesReveal('a'), false)

  openChatSummaryChanges('merged', 'a')
  assert.equal(takeChangesReveal('a'), true)
})

test('another chat cannot take the reveal, which stays for the chat it names', () => {
  openChatSummaryChanges('merged', 'a')
  assert.equal(takeChangesReveal('b'), false)
  assert.equal(takeChangesReveal('a'), true)
})

test('with two splits open, the other split taking first leaves the reveal for its chat', () => {
  openChatSummaryChanges('merged', 'right')
  // Both panels open in one commit; the left split's list runs its effect first.
  assert.equal(takeChangesReveal('left'), false)
  assert.equal(takeChangesReveal('right'), true)
})

test('a reveal not taken in time is stale', () => {
  const asked = Date.now()

  openChatSummaryChanges('merged', 'a')
  assert.equal(takeChangesReveal('a', asked + REVEAL_LIFETIME_MS + 1000), false)

  openChatSummaryChanges('merged', 'a')
  assert.equal(takeChangesReveal('a', Date.now() + REVEAL_LIFETIME_MS - 1000), true)
})

test('closing the panel drops the reveal, and choosing a filter asks for none', () => {
  openChatSummaryChanges('closed', 'a')
  setChatSummaryOpen(PRIMARY_PANE_ID, false)
  assert.equal(takeChangesReveal('a'), false)

  setChangesFilter('open')
  assert.equal(takeChangesReveal('a'), false)
})

test('opening on Sub-agents asks that chat for one reveal, which the Changes list cannot take', () => {
  openChatSummarySubAgents('done', 'a')
  assert.equal(takeChangesReveal('a'), false)
  assert.equal(takeSubAgentsReveal('b'), false)
  assert.equal(takeSubAgentsReveal('a'), true)
  assert.equal(takeSubAgentsReveal('a'), false)
})

test('opening on Changes replaces a Sub-agents reveal not yet taken', () => {
  openChatSummarySubAgents('done', 'a')
  openChatSummaryChanges('merged', 'a')
  assert.equal(takeSubAgentsReveal('a'), false)
  assert.equal(takeChangesReveal('a'), true)
})

test('a Sub-agents reveal expires and closing drops it; choosing a filter asks for none', () => {
  const asked = Date.now()

  openChatSummarySubAgents('done', 'a')
  assert.equal(takeSubAgentsReveal('a', asked + REVEAL_LIFETIME_MS + 1000), false)

  openChatSummarySubAgents('active', 'a')
  setChatSummaryOpen(PRIMARY_PANE_ID, false)
  assert.equal(takeSubAgentsReveal('a'), false)

  setSubAgentsFilter('all')
  assert.equal(takeSubAgentsReveal('a'), false)
})
