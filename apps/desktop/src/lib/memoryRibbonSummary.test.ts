import assert from 'node:assert/strict'
import test from 'node:test'

import { appliedCount, provenanceSummary } from './memoryRibbonSummary.ts'

const base = {
  automatic: true,
  indexRide: false,
  usedCount: 0,
  loadedCount: 0,
  recalledCount: 3,
}

test('automatic: reads as the step it is, and keeps the count honest', () => {
  // Verb-first so the row sits in the same voice as the tool rows it heads.
  assert.equal(provenanceSummary(base), 'Recalled 3 memories')
  assert.equal(provenanceSummary({ ...base, recalledCount: 1 }), 'Recalled 1 memory')
})

test('automatic: verified use is reported alongside, never instead of, the recall', () => {
  // The old wording replaced the count with the used count, so a turn that
  // recalled five and used one read as "1 memory used" — losing the fact that
  // four others were shown and ignored.
  assert.equal(provenanceSummary({ ...base, usedCount: 2 }), 'Recalled 3 memories · used 2')
  assert.equal(
    provenanceSummary({ ...base, recalledCount: 1, usedCount: 1 }),
    'Recalled 1 memory · used 1',
  )
})

test('used is counted over the section, so it can never outrun the count beside it', () => {
  // The bug this exists to prevent: the recalled row listed 5 and reported
  // "used 9", because `used` was counted turn-wide while the count next to it
  // was section-scoped. Two denominators in one sentence.
  const recalled = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const tiers = {
    a: 'applied',
    b: 'fetched',
    c: 'not_applicable',
    // Applied, but looked up mid-turn — it belongs to the other section.
    z: 'applied',
  }

  assert.equal(appliedCount(recalled, tiers), 1)
  assert.equal(
    provenanceSummary({ ...base, recalledCount: recalled.length, usedCount: 1 }),
    'Recalled 3 memories · used 1',
  )
})

test('appliedCount ignores verdicts for memories the section does not list', () => {
  assert.equal(appliedCount([], { z: 'applied' }), 0)
  assert.equal(appliedCount([{ id: 'a' }], {}), 0)
})

test('legacy non-index-ride keeps the shown/loaded framing', () => {
  assert.equal(
    provenanceSummary({ ...base, automatic: false, loadedCount: 2 }),
    '3 memories shown · 2 loaded',
  )
})

test('index-ride and search-only turns report loads only', () => {
  assert.equal(
    provenanceSummary({
      ...base,
      automatic: false,
      indexRide: true,
      recalledCount: 40,
      loadedCount: 1,
    }),
    '1 memory loaded',
  )
  assert.equal(
    provenanceSummary({
      ...base,
      automatic: false,
      recalledCount: 0,
      loadedCount: 2,
    }),
    '2 memories loaded via search',
  )
})
