import assert from 'node:assert/strict'
import { test } from 'node:test'

import { findFreePort, releasePort } from './dev-ports.ts'

const available = async () => true

test('one launcher never assigns the same port to two services', async () => {
  const first = await findFreePort(49_152, available)
  const second = await findFreePort(first, available)

  try {
    assert.notEqual(second, first)
  } finally {
    releasePort(first)
    releasePort(second)
  }
})

test('an exhausted range fails instead of returning an unclaimed port', async () => {
  await assert.rejects(
    findFreePort(49_152, async () => false),
    /no free port found/,
  )
})
