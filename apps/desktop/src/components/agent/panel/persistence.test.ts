import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeMemoryProvenanceLabels } from './memoryProvenanceLabels.ts'
import { normalizeTurnInterruptedPart } from './turnInterrupted.ts'

test('memory provenance keeps valid labels across transcript reload', () => {
  assert.deepEqual(
    normalizeMemoryProvenanceLabels({ 'memory-1': 'Stripe Cache DB', invalid: 42 }),
    {
      'memory-1': 'Stripe Cache DB',
    },
  )
})

test('turn-interrupted parts survive transcript reload with an unknown reason downgraded', () => {
  assert.deepEqual(
    normalizeTurnInterruptedPart({
      type: 'turn-interrupted',
      id: 'stream-1:interrupted',
      reason: 'weird',
      message: 'OpenAB ACP session/prompt timed out',
      createdAt: '2026-08-27T09:45:21.000Z',
    }),
    {
      type: 'turn-interrupted',
      id: 'stream-1:interrupted',
      reason: 'error',
      message: 'OpenAB ACP session/prompt timed out',
      createdAt: '2026-08-27T09:45:21.000Z',
    },
  )
  assert.equal(normalizeTurnInterruptedPart({ type: 'turn-interrupted', id: 'x' }), null)
})
