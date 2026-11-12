import assert from 'node:assert/strict'
import { test } from 'node:test'

import { readBotTaskAccess } from './botTaskAccess.ts'

test('an owner can open their task without probing its transcript', async () => {
  assert.equal(await readBotTaskAccess(true, () => assert.fail('unexpected probe')), true)
})

test('a non-owner with existing session read access retains the Task entry', async () => {
  assert.equal(await readBotTaskAccess(false, async () => ({ readOnly: true })), true)
})

test('chat membership alone does not grant Task access', async () => {
  assert.equal(
    await readBotTaskAccess(false, async () => {
      throw new Error('403')
    }),
    false,
  )
})
