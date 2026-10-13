import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'

import { acquireDevInstance, instanceRunning } from './dev-instance.ts'

test('one concurrent launcher per instance key; other keys remain independent', async (t) => {
  const key = `test-${randomUUID()}`
  const results = await Promise.allSettled([acquireDevInstance(key), acquireDevInstance(key)])
  const owner = results.find((result) => result.status === 'fulfilled')

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1)
  assert.ok(owner?.status === 'fulfilled')
  t.after(owner.value)
  await assert.rejects(acquireDevInstance(key), /already running.*NUPHOS_DEV_INSTANCE/)
  assert.equal(await instanceRunning(key), true)
  t.after(await acquireDevInstance(`${key}-other`))
})

test('stopping a launcher releases its lease for the next invocation', async (t) => {
  const key = `test-${randomUUID()}`
  const release = await acquireDevInstance(key)

  release()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(await instanceRunning(key), false)
  const next = await acquireDevInstance(key)

  assert.equal(typeof next, 'function')
  t.after(next)
})
