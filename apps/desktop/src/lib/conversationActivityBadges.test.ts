import assert from 'node:assert/strict'
import test from 'node:test'

import {
  conversationActivityBadges,
  conversationReadOnlyLabel,
} from './conversationActivityBadges.ts'

test('ordinary Nuphos conversations have no badge', () => {
  assert.deepEqual(conversationActivityBadges({ origin: 'nuphos', linkedSlackThread: false }), [])
})

test('Slack-originated conversations have a Slack badge', () => {
  assert.deepEqual(conversationActivityBadges({ origin: 'slack', linkedSlackThread: true }), [
    { kind: 'slack', label: 'Slack', description: 'Started from Slack' },
  ])
})

test('trigger conversations have a Trigger badge', () => {
  assert.deepEqual(conversationActivityBadges({ origin: 'trigger', linkedSlackThread: false }), [
    {
      kind: 'trigger',
      label: 'Trigger',
      description: 'Started automatically by a trigger',
    },
  ])
})

test('trigger conversations linked to Slack show both badges', () => {
  assert.deepEqual(conversationActivityBadges({ origin: 'trigger', linkedSlackThread: true }), [
    {
      kind: 'trigger',
      label: 'Trigger',
      description: 'Started automatically by a trigger',
    },
    { kind: 'slack', label: 'Slack', description: 'Linked to a Slack thread' },
  ])
})

test('unknown Slack-linked conversations still show their Slack association', () => {
  assert.deepEqual(conversationActivityBadges({ origin: 'unknown', linkedSlackThread: true }), [
    { kind: 'slack', label: 'Slack', description: 'Linked to a Slack thread' },
  ])
})

test('read-only copy explains trigger and Slack context', () => {
  // Read-only + thread = a non-owner viewer; their reply surface is the thread.
  assert.equal(
    conversationReadOnlyLabel({ origin: 'trigger', linkedSlackThread: true }, true),
    'Triggered investigation · reply in the Slack thread',
  )
  assert.equal(
    conversationReadOnlyLabel({ origin: 'slack', linkedSlackThread: true }, true),
    'Slack conversation · reply in the Slack thread',
  )
})

test('read-only copy does not promise a Slack action without a thread link', () => {
  assert.equal(
    conversationReadOnlyLabel({ origin: 'slack', linkedSlackThread: true }, false),
    'Slack conversation · view-only',
  )
  assert.equal(
    conversationReadOnlyLabel({ origin: 'trigger', linkedSlackThread: true }, false),
    'Triggered investigation · view-only',
  )
})

test('read-only copy falls back safely for ordinary shared conversations', () => {
  assert.equal(
    conversationReadOnlyLabel({ origin: 'nuphos', linkedSlackThread: false }, false),
    'Shared conversation · view-only',
  )
})
