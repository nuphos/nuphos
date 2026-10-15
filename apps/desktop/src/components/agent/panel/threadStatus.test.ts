import assert from 'node:assert/strict'
import test from 'node:test'

import { threadStatusOf } from './threadStatus.ts'

import type { RuntimeExecution } from '../../../lib/runtimeExecution.ts'

const snapshot = (state: RuntimeExecution['state'], ageMs: number) =>
  ({ state, schemaVersion: 2, observedAt: performance.now() - ageMs }) as RuntimeExecution

test('a stale snapshot that still says active is unknown, not done', () => {
  assert.equal(threadStatusOf(snapshot('active', 60_000)), 'loading')
})

test('a fresh idle snapshot is done, and no snapshot is loading', () => {
  assert.equal(threadStatusOf(snapshot('idle', 0)), 'done')
  assert.equal(threadStatusOf(undefined), 'loading')
})
