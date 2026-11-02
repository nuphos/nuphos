import assert from 'node:assert/strict'
import { test } from 'node:test'

import { pinnedBlocks, pinnedStepTarget } from './pinned-order.ts'

import type { Item } from './types'

const row = (key: string, parentKey?: string): Item => ({
  key,
  label: key,
  enabled: true,
  ...(parentKey ? { parentKey } : {}),
})

test('a pinned chat and its sub-agents form one block', () => {
  const { heads, headOf } = pinnedBlocks([
    row('manager'),
    row('relay'),
    row('worker', 'manager'),
    row('nested', 'worker'),
  ])

  assert.deepEqual(heads, ['manager', 'relay'])
  assert.equal(headOf.get('worker'), 'manager')
  assert.equal(headOf.get('nested'), 'manager')
  assert.equal(headOf.get('relay'), 'relay')
})

test('a step lands before the right neighbour, last, or nowhere at an edge', () => {
  const heads = ['a', 'b', 'c']

  assert.equal(pinnedStepTarget(heads, 'b', -1), 'a')
  assert.equal(pinnedStepTarget(heads, 'a', 1), 'c')
  assert.equal(pinnedStepTarget(heads, 'b', 1), null)
  assert.equal(pinnedStepTarget(heads, 'a', -1), undefined)
  assert.equal(pinnedStepTarget(heads, 'c', 1), undefined)
  // A sub-agent is not a block of its own, so it cannot step on its own.
  assert.equal(pinnedStepTarget(heads, 'worker', -1), undefined)
})
