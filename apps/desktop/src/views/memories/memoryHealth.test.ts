import assert from 'node:assert/strict'
import { test } from 'node:test'

import { deriveMemoryHealth } from './memoryHealth.ts'

import type { AgentMemoryScorecard } from '../../api'

type Summary = AgentMemoryScorecard['summary']

// Run with: pnpm test  (node --experimental-strip-types --test; Node >= 22.6)

function summary(over: {
  total: number
  withRecall?: number
  withApplied: number
  ran: number
  judgeFailed?: number
  distillFailed?: number
}): Summary {
  return {
    windowDays: 90,
    learnedLast7d: 11,
    turns: {
      total: over.total,
      withRecall: over.withRecall ?? 0,
      withApplied: over.withApplied,
      recallRate: over.total ? (over.withRecall ?? 0) / over.total : 0,
      zeroRecallRate: 0,
      appliedRate: over.total ? over.withApplied / over.total : 0,
    },
    judge: {
      ran: over.ran,
      failed: over.judgeFailed ?? 0,
      pending: 0,
      skippedDisabled: over.total - over.ran,
      skippedSampled: 0,
      skippedZeroCandidates: 0,
      ranRate: over.total ? over.ran / over.total : 0,
    },
    distill: { saved: over.withApplied, failed: over.distillFailed ?? 0 },
  }
}

test('applied divides by judged turns, not all turns (the "used 2%" fix)', () => {
  // 18 applied out of 967 total is 2%; out of 58 judged it is the honest 31%.
  const h = deriveMemoryHealth(summary({ total: 967, withApplied: 18, ran: 58 }))

  assert.deepEqual(h.applied, { pct: 31, applied: 18, judged: 58 })
})

test('no judged turns yields null applied, never a divide-by-zero', () => {
  const h = deriveMemoryHealth(summary({ total: 100, withApplied: 0, ran: 0 }))

  assert.equal(h.applied, null)
})

test('every rate carries the counts it was computed from', () => {
  // Sample size is communicated by showing the denominator, not by a
  // confidence flag: 18/58 judged against 967 turns is thin, and the reader
  // can see that from the numbers alone.
  const h = deriveMemoryHealth(summary({ total: 967, withApplied: 18, ran: 58 }))

  assert.deepEqual(h.applied, { pct: 31, applied: 18, judged: 58 })
  assert.equal(h.checkedTurns, 58)
  assert.equal(h.recall.total, 967)
})

test('the model exposes only what the page renders', () => {
  // Pipeline error counts were removed on purpose: this page has no admin
  // gate, and a failure count a reader cannot act on is alarm without
  // recourse. If they come back, they come back with an audience.
  const h = deriveMemoryHealth(summary({ total: 100, withApplied: 10, ran: 40 }))

  assert.deepEqual(Object.keys(h).sort(), [
    'applied',
    'checkedTurns',
    'learned7d',
    'recall',
    'windowDays',
  ])
})

test('applied% can never exceed 100 (withApplied is a subset of judged)', () => {
  const h = deriveMemoryHealth(summary({ total: 60, withApplied: 58, ran: 58 }))

  assert.ok(h.applied && h.applied.pct <= 100)
})
