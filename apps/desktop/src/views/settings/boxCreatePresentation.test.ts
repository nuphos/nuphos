import assert from 'node:assert/strict'
import { test } from 'node:test'

import { boxQuota, nextBoxName, quotaCells } from './boxCreatePresentation.ts'

test('nextBoxName counts up after the highest "Box N", ignoring other names', () => {
  assert.equal(nextBoxName([]), 'Box 1')
  assert.equal(nextBoxName(['Personal Laptop', 'Box 1', 'Box 3', 'Box 12x']), 'Box 4')
})

test('boxQuota reports used and left vCPU, never below zero, unknown use as null, and null without a limit', () => {
  assert.equal(boxQuota({ limitVcpus: null, usedVcpus: 4 }), null)
  assert.deepEqual(boxQuota({ limitVcpus: 8, usedVcpus: 2 }), { limit: 8, used: 2, left: 6 })
  assert.deepEqual(boxQuota({ limitVcpus: 4, usedVcpus: 6 }), { limit: 4, used: 6, left: 0 })
  assert.deepEqual(boxQuota({ limitVcpus: 4, usedVcpus: null }), {
    limit: 4,
    used: null,
    left: null,
  })
})

test('quotaCells marks used, then the new Box, then free; the new Box is over when it does not fit', () => {
  assert.deepEqual(quotaCells(6, 2, 2), ['used', 'used', 'adding', 'adding', 'free', 'free'])
  assert.deepEqual(quotaCells(4, 2, 4), ['used', 'used', 'over', 'over'])
  assert.deepEqual(quotaCells(2, 3, 2), ['used', 'used'])
})
