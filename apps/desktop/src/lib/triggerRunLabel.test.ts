import assert from 'node:assert/strict'
import test from 'node:test'

import { triggerRunLabel } from './triggerRunLabel.ts'

import type { AgentConversationTriggerRun } from '../api.ts'

// A Trigger's run list is mostly identical rows — same trigger, same owner,
// often the same title. How the run started is the one thing that distinguishes
// them, so the label has to say it rather than repeat "Trigger" on every row.

test('a scheduled run says the schedule ran it', () => {
  assert.deepEqual(triggerRunLabel({ id: 't1', kind: 'scheduled' }), {
    label: 'Scheduled',
    description: 'Fired by this trigger schedule',
  })
})

test('a manual run says a person pressed Run now', () => {
  assert.deepEqual(triggerRunLabel({ id: 't1', kind: 'manual' }), {
    label: 'Manual',
    description: 'Fired by hand from Nuphos',
  })
})

test('a webhook run says an external system called in', () => {
  assert.equal(triggerRunLabel({ id: 't1', kind: 'webhook' })?.label, 'Webhook')
})

test('a legacy alert run from an older backend carries no badge', () => {
  const legacy = { id: 't1', kind: 'alert' } as unknown as AgentConversationTriggerRun

  assert.equal(triggerRunLabel(legacy), null)
})

test('a Watch group run names the item behind the shared ingress', () => {
  assert.deepEqual(triggerRunLabel({ id: 't1', kind: 'webhook', memberKey: 'api-latency' }), {
    label: 'Webhook',
    description: 'Fired by an external webhook',
    memberKey: 'api-latency',
  })
})

test('a run of unknown kind carries no badge rather than a made-up one', () => {
  // The stamp is written by the executor, so a kind-less run means an older
  // document. Guessing "Scheduled" there would be a lie in the one list built
  // to tell scheduled runs apart.
  assert.equal(triggerRunLabel({ id: 't1' }), null)
})

test('a run of unknown kind still names its group member', () => {
  assert.deepEqual(triggerRunLabel({ id: 't1', memberKey: 'api-latency' }), {
    memberKey: 'api-latency',
  })
})

test('a conversation that is not a run has nothing to label', () => {
  assert.equal(triggerRunLabel(undefined), null)
})
