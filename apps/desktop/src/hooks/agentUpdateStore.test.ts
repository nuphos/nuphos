import assert from 'node:assert/strict'
import { test } from 'node:test'

import { withResult } from './agentUpdateStore.ts'

const start = () => {}
const available = { state: 'available' as const, version: '2.1.5', start }

test('an update in flight reads as updating', () => {
  assert.equal(withResult('k', new Set(['k']), new Map(), available)?.state, 'updating')
  assert.deepEqual(withResult('k', new Set(['k']), new Map(), undefined), { state: 'updating' })
})

test('a finished update says so even once nothing is pending', () => {
  const ended = new Map([['k', { state: 'done' as const, version: '2.1.5' }]])

  assert.deepEqual(withResult('k', new Set(), ended, undefined), {
    state: 'done',
    version: '2.1.5',
  })
})

test('a failed update stays as a retry with its reason', () => {
  const ended = new Map([['k', { state: 'failed' as const, reason: 'Installed by Homebrew' }]])
  const update = withResult('k', new Set(), ended, available)

  assert.equal(update?.state, 'failed')
  assert.equal(update?.reason, 'Installed by Homebrew')
  assert.equal(update?.start, start)
})

test('with no result the pending update passes through', () => {
  assert.equal(withResult('k', new Set(), new Map(), available), available)
})
