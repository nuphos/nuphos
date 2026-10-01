import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  isTriggerAlreadyDeletedError,
  pendingTriggerFromDeleteResult,
} from './agentTriggerDelete.ts'

const pendingTrigger = {
  id: 'trigger-1',
  userId: 'user-1',
  name: 'Watch Grafana',
  triggerType: 'webhook',
  messageTemplate: 'Investigate this alert.',
  enabled: false,
  cleanupStatus: 'deleting',
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
}

test('returns a pending trigger from the provider-cleanup response', () => {
  assert.deepEqual(
    pendingTriggerFromDeleteResult({ ok: true, deleted: false, trigger: pendingTrigger }),
    pendingTrigger,
  )
})

test('treats immediate and legacy successful responses as completed deletion', () => {
  assert.equal(pendingTriggerFromDeleteResult({ ok: true, deleted: true }), null)
  assert.equal(pendingTriggerFromDeleteResult({ ok: true }), null)
  assert.equal(pendingTriggerFromDeleteResult(undefined), null)
})

test('does not expose a malformed pending response to renderer state', () => {
  assert.equal(pendingTriggerFromDeleteResult({ ok: true, deleted: false }), null)
  assert.equal(pendingTriggerFromDeleteResult({ ok: true, deleted: false, trigger: {} }), null)
  assert.equal(
    pendingTriggerFromDeleteResult({
      ok: true,
      deleted: false,
      trigger: { id: 'trigger-1' },
    }),
    null,
  )
})

test('treats an already-removed trigger as a successful idempotent retry', () => {
  assert.equal(isTriggerAlreadyDeletedError(new Error('Trigger not found')), true)
  assert.equal(isTriggerAlreadyDeletedError(new Error('HTTP 404')), true)
  assert.equal(
    isTriggerAlreadyDeletedError(
      new Error("Error invoking remote method 'agent:deleteTrigger': Error: Trigger not found"),
    ),
    true,
  )
  assert.equal(isTriggerAlreadyDeletedError(new Error('Provider cleanup failed')), false)
  assert.equal(isTriggerAlreadyDeletedError('Trigger not found'), false)
})
