import assert from 'node:assert/strict'
import { test } from 'node:test'

import { effortCommit } from './effortCommit.ts'

test('rapid keyboard stops save only the final committed effort', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const commit = effortCommit()
  const writes: string[] = []

  commit.schedule(() => writes.push('medium'))
  t.mock.timers.tick(100)
  commit.schedule(() => writes.push('high'))
  t.mock.timers.tick(100)
  commit.schedule(() => writes.push('xhigh'))
  t.mock.timers.tick(349)
  assert.deepEqual(writes, [])
  t.mock.timers.tick(1)
  assert.deepEqual(writes, ['xhigh'])
})

test('closing before the delay saves the final effort once, including a later reopen', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const commit = effortCommit()
  const writes: string[] = []

  commit.schedule(() => writes.push('medium'))
  commit.schedule(() => writes.push('xhigh'))
  commit.flush()
  commit.flush()
  t.mock.timers.tick(350)
  assert.deepEqual(writes, ['xhigh'])
  commit.schedule(() => writes.push('low'))
  commit.flush()
  assert.deepEqual(writes, ['xhigh', 'low'])
})

test('returning to the acknowledged stop cancels the intermediate change', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const commit = effortCommit()
  const writes: string[] = []

  commit.schedule(() => writes.push('medium'))
  commit.schedule(undefined)
  commit.flush()
  t.mock.timers.tick(350)
  assert.deepEqual(writes, [])
})
