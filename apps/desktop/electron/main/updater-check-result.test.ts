import assert from 'node:assert/strict'
import { test } from 'node:test'

import { checkOutcome, describeCheckOutcome } from './updater-check-result.ts'

test('a newer version reports an update, same version reports up to date', () => {
  assert.deepEqual(checkOutcome('0.39.0', '0.40.0'), { kind: 'update', version: '0.40.0' })
  assert.deepEqual(checkOutcome('0.39.0', '0.39.0'), { kind: 'up-to-date', version: '0.39.0' })
  // A feed that answers without a version is "no update", never a crash.
  assert.deepEqual(checkOutcome('0.39.0', undefined), { kind: 'up-to-date', version: '0.39.0' })
})

test('dialog wording covers every outcome and errors render as errors', () => {
  assert.equal(describeCheckOutcome({ kind: 'up-to-date', version: '1.0.0' }).type, 'info')
  assert.match(
    describeCheckOutcome({ kind: 'update', version: '1.1.0' }).message,
    /1\.1\.0 is available/,
  )
  assert.match(
    describeCheckOutcome({ kind: 'update', version: '1.1.0' }).detail ?? '',
    /install when you quit/,
  )
  assert.equal(describeCheckOutcome({ kind: 'error', message: 'ENETDOWN' }).type, 'error')
  assert.equal(describeCheckOutcome({ kind: 'error', message: 'ENETDOWN' }).detail, 'ENETDOWN')
  assert.match(describeCheckOutcome({ kind: 'dev' }).message, /development/)
  assert.match(describeCheckOutcome({ kind: 'busy' }).message, /already running/)
})
