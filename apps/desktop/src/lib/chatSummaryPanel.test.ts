import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  PRIMARY_PANE_ID,
  REVEAL_LIFETIME_MS,
  isChatSummaryOpen,
  openChatSummaryChanges,
  openChatSummarySubAgents,
  setChangesFilter,
  setChatSummaryOpen,
  setPaneSession,
  setSubAgentsFilter,
  takeChangesReveal,
  takeSubAgentsReveal,
  toggleChatSummary,
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
  // The pane showing the chat is the one whose close drops its reveal.
  setPaneSession(PRIMARY_PANE_ID, 'a')
  openChatSummaryChanges('closed', 'a')
  setChatSummaryOpen(PRIMARY_PANE_ID, false)
  assert.equal(takeChangesReveal('a'), false)

  setChangesFilter('open')
  assert.equal(takeChangesReveal('a'), false)

  setPaneSession(PRIMARY_PANE_ID, null)
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

  setPaneSession(PRIMARY_PANE_ID, 'a')
  openChatSummarySubAgents('done', 'a')
  assert.equal(takeSubAgentsReveal('a', asked + REVEAL_LIFETIME_MS + 1000), false)

  openChatSummarySubAgents('active', 'a')
  setChatSummaryOpen(PRIMARY_PANE_ID, false)
  assert.equal(takeSubAgentsReveal('a'), false)

  setSubAgentsFilter('all')
  assert.equal(takeSubAgentsReveal('a'), false)

  setPaneSession(PRIMARY_PANE_ID, null)
})

test('each pane opens and closes on its own', () => {
  setChatSummaryOpen('pane-1', true)
  assert.equal(isChatSummaryOpen('pane-1'), true)
  assert.equal(isChatSummaryOpen('pane-2'), false)

  toggleChatSummary('pane-2')
  setChatSummaryOpen('pane-1', false)
  assert.equal(isChatSummaryOpen('pane-1'), false)
  assert.equal(isChatSummaryOpen('pane-2'), true)

  toggleChatSummary('pane-2')
  assert.equal(isChatSummaryOpen('pane-2'), false)
})

test('a badge opens the panel only in the pane showing that chat', () => {
  setPaneSession('pane-1', 'chat-1')
  setPaneSession('pane-2', 'chat-2')

  openChatSummaryChanges('all', 'chat-1')
  assert.equal(isChatSummaryOpen('pane-1'), true)
  assert.equal(isChatSummaryOpen('pane-2'), false)

  setChatSummaryOpen('pane-1', false)
  setPaneSession('pane-1', null)
  setPaneSession('pane-2', null)
})

test('an open asked before the chat is shown lands when a pane registers it', () => {
  openChatSummaryChanges('all', 'chat-3') // no pane shows chat-3 yet
  assert.equal(isChatSummaryOpen('pane-1'), false)

  setPaneSession('pane-1', 'chat-3')
  assert.equal(isChatSummaryOpen('pane-1'), true)

  setChatSummaryOpen('pane-1', false)
  setPaneSession('pane-1', null)
})

test('a pending open not taken in time is dropped', () => {
  openChatSummaryChanges('all', 'chat-4')
  setPaneSession('pane-1', 'chat-4', Date.now() + REVEAL_LIFETIME_MS + 1000)
  assert.equal(isChatSummaryOpen('pane-1'), false)

  setPaneSession('pane-1', null)
})
