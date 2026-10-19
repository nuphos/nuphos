import assert from 'node:assert/strict'
import test from 'node:test'

import { threadStatusOf } from './threadStatus.ts'

import type { RuntimeExecution } from '../../../lib/runtimeExecution.ts'

const snapshot = (state: RuntimeExecution['state']) =>
  ({ state, schemaVersion: 2 }) as RuntimeExecution

test('an active snapshot is running until a newer one says how it ended', () => {
  assert.equal(threadStatusOf(snapshot('active')), 'running')
})

test('an idle snapshot is done, and no snapshot is loading', () => {
  assert.equal(threadStatusOf(snapshot('idle')), 'done')
  assert.equal(threadStatusOf(undefined), 'loading')
})
