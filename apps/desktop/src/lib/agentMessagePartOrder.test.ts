import assert from 'node:assert/strict'
import test from 'node:test'

import {
  normalizeRecallFirstOrder,
  recallLeadCount,
  textDeltaInsertionIndex,
} from './agentMessagePartOrder.ts'

test('text deltas append normally when there is no provenance footer', () => {
  assert.equal(textDeltaInsertionIndex([]), 0)
  assert.equal(textDeltaInsertionIndex([{ type: 'text' }]), 1)
  assert.equal(textDeltaInsertionIndex([{ type: 'tool' }, { type: 'text' }]), 2)
})

test('late text is inserted before a trailing provenance footer', () => {
  assert.equal(
    textDeltaInsertionIndex([{ type: 'tool' }, { type: 'text' }, { type: 'memory-provenance' }]),
    2,
  )
})

test('late text stays before every trailing provenance footer', () => {
  assert.equal(
    textDeltaInsertionIndex([
      { type: 'text' },
      { type: 'memory-provenance' },
      { type: 'memory-provenance' },
    ]),
    1,
  )
})

test('persisted split text is reunited, with recall hoisted above it', () => {
  assert.deepEqual(
    normalizeRecallFirstOrder([
      { type: 'text', text: 'Complete ' },
      { type: 'memory-provenance', id: 'p1' },
      { type: 'text', text: 'answer.' },
    ]),
    [
      { type: 'memory-provenance', id: 'p1' },
      { type: 'text', text: 'Complete answer.' },
    ],
  )
})

test('intentional adjacent text parts stay separate when recall is elsewhere', () => {
  assert.deepEqual(
    normalizeRecallFirstOrder([
      { type: 'memory-provenance', id: 'p1' },
      { type: 'text', text: 'Progress update.' },
      { type: 'text', text: 'Final answer.' },
    ]),
    [
      { type: 'memory-provenance', id: 'p1' },
      { type: 'text', text: 'Progress update.' },
      { type: 'text', text: 'Final answer.' },
    ],
  )
})

test('a turn reads in the order it happened: recalled, then work, then learned', () => {
  assert.deepEqual(
    normalizeRecallFirstOrder([
      { type: 'text', text: 'Complete ' },
      { type: 'memory-ingest', id: 'learned-1' },
      { type: 'tool' },
      { type: 'memory-provenance', id: 'p1' },
      { type: 'memory-ingest', id: 'learned-2' },
    ]),
    [
      // Recall happened before the turn started, whatever order the frames
      // arrived in — the finalizer re-appends this part mid-turn.
      { type: 'memory-provenance', id: 'p1' },
      { type: 'text', text: 'Complete ' },
      { type: 'tool' },
      // Learning happens after the answer, so the cards stay last.
      { type: 'memory-ingest', id: 'learned-1' },
      { type: 'memory-ingest', id: 'learned-2' },
    ],
  )
})

test('recall stays above the collapsed-work fold, whatever the turn did', () => {
  // The fold swallows everything before the final answer. Recall is not work
  // — hidden in there it would be LESS visible than the footer it replaced,
  // which is the whole bug this ordering exists to fix.
  const turn = normalizeRecallFirstOrder([
    { type: 'text', text: 'Answer.' },
    { type: 'tool' },
    { type: 'memory-provenance', id: 'p1' },
  ])

  assert.equal(turn[0].type, 'memory-provenance')
  assert.equal(recallLeadCount(turn), 1)
})

test('turns without recall put nothing above the fold', () => {
  assert.equal(recallLeadCount([{ type: 'tool' }, { type: 'text', text: 'hi' }]), 0)
  assert.equal(recallLeadCount([]), 0)
})

test('only LEADING provenance is hoisted — a later one belongs to the work', () => {
  // Counting every provenance part would lift a mid-turn one out of the fold
  // too, and it would render detached from the work that produced it.
  assert.equal(recallLeadCount([{ type: 'tool' }, { type: 'memory-provenance', id: 'p1' }]), 0)
})

test('no-provenance input returns a fresh array, not the caller-owned one', () => {
  const input = [{ type: 'text', text: 'hi' }]
  const output = normalizeRecallFirstOrder(input)

  assert.deepEqual(output, input)
  assert.notEqual(output, input)
})

test('post-hoc learned cards stay last, below the answer they came from', () => {
  assert.deepEqual(
    normalizeRecallFirstOrder([
      { type: 'tool' },
      { type: 'text', text: 'Complete ' },
      { type: 'memory-provenance', id: 'p1' },
      { type: 'text', text: 'answer.' },
      { type: 'memory-ingest', id: 'learned' },
    ]),
    [
      { type: 'memory-provenance', id: 'p1' },
      { type: 'tool' },
      { type: 'text', text: 'Complete answer.' },
      { type: 'memory-ingest', id: 'learned' },
    ],
  )
})
