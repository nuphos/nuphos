import assert from 'node:assert/strict'
import test from 'node:test'

import { newCleanupFailures } from './cleanupFailures.ts'

import type { AgentTrigger } from '../../api'

function trigger(id: string, cleanupStatus?: AgentTrigger['cleanupStatus']): AgentTrigger {
  return {
    id,
    userId: 'owner',
    name: id,
    triggerType: 'webhook',
    messageTemplate: 'check',
    enabled: false,
    ...(cleanupStatus ? { cleanupStatus } : {}),
  } as AgentTrigger
}

const ids = (rows: AgentTrigger[]) => rows.map((row) => row.id)

test('a failure already on screen is not new', () => {
  assert.deepEqual(
    ids(newCleanupFailures([trigger('old', 'cleanup_failed')], [trigger('old', 'cleanup_failed')])),
    [],
  )
})

test('a row seen Removing and now failed is reported once', () => {
  const removing = [trigger('a', 'deleting')]
  const failed = [trigger('a', 'cleanup_failed')]

  assert.deepEqual(ids(newCleanupFailures(removing, failed)), ['a'])
  // The next refresh starts from the failed state, so it is not reported again.
  assert.deepEqual(ids(newCleanupFailures(failed, failed)), [])
})

test('a retry that fails again is reported once more', () => {
  const failed = [trigger('a', 'cleanup_failed')]
  const retrying = [trigger('a', 'deleting')]

  assert.deepEqual(ids(newCleanupFailures(failed, retrying)), [])
  assert.deepEqual(ids(newCleanupFailures(retrying, failed)), ['a'])
})

test('only the row that just failed is reported, not older failures beside it', () => {
  const previous = [trigger('new', 'deleting'), trigger('old', 'cleanup_failed')]
  const next = [trigger('new', 'cleanup_failed'), trigger('old', 'cleanup_failed')]

  assert.deepEqual(ids(newCleanupFailures(previous, next)), ['new'])
})

test('a failed row that was never seen Removing is not reported', () => {
  assert.deepEqual(ids(newCleanupFailures([], [trigger('a', 'cleanup_failed')])), [])
})

test('a row whose removal finished is not reported', () => {
  assert.deepEqual(ids(newCleanupFailures([trigger('a', 'deleting')], [])), [])
})
