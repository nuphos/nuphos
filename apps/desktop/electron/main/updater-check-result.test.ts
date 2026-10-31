import assert from 'node:assert/strict'
import { test } from 'node:test'

import { checkOutcome, describeCheckOutcome } from './updater-check-result.ts'

test('a newer version reports an update, same version reports up to date', () => {
  assert.deepEqual(checkOutcome('0.39.0', '0.40.0'), { kind: 'update', version: '0.40.0' })
  assert.deepEqual(checkOutcome('0.39.0', '0.39.0'), { kind: 'up-to-date', version: '0.39.0' })
  // A feed that answers without a version is "no update", never a crash.
  assert.deepEqual(checkOutcome('0.39.0', undefined), { kind: 'up-to-date', version: '0.39.0' })
})

test('only a downloaded update offers Restart', () => {
  assert.equal(describeCheckOutcome({ kind: 'ready', version: '1.1.0' }).confirmLabel, 'Restart')
  assert.match(describeCheckOutcome({ kind: 'ready', version: '1.1.0' }).message, /1\.1\.0/)
  for (const outcome of [
    { kind: 'up-to-date', version: '1.0.0' },
    { kind: 'update', version: '1.1.0' },
    { kind: 'error' },
  ] as const) {
    assert.equal(describeCheckOutcome(outcome).confirmLabel, undefined)
  }
})

test('a downloading update points to the sidebar button, not to quitting', () => {
  const box = describeCheckOutcome({ kind: 'update', version: '1.1.0' })

  assert.match(box.message, /1\.1\.0/)
  assert.match(box.detail, /Restart button/)
})
