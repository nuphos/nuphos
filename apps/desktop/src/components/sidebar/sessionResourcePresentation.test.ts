import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  changeStatus,
  chipNames,
  fittingChipCount,
  minimumRowWidth,
  pullStateColor,
  resourceChips,
  resourceFullLabel,
  resourceLabel,
  resourceMark,
  resourceStatus,
} from './sessionResourcePresentation.ts'

import type { SessionResource } from '../../api/session-resource-types'

const resource = (overrides: Partial<SessionResource>): SessionResource => ({
  id: 'r1',
  provider: 'github',
  title: 'Fix chips',
  url: 'https://github.com/o/r/pull/1',
  state: 'open',
  linkedAt: '2026-10-21T00:00:00Z',
  ...overrides,
})

test('labels a PR by number, a thread by title and an issue by identifier', () => {
  assert.equal(resourceLabel(resource({ number: 630 })), '#630')
  assert.equal(
    resourceLabel(resource({ provider: 'slack', title: 'incident room' })),
    'incident room',
  )
  assert.equal(resourceLabel(resource({ provider: 'linear', title: 'ENG-12 Fix chips' })), 'ENG-12')
})

test('a full label adds the PR title to its number', () => {
  assert.equal(resourceFullLabel(resource({ number: 630 })), '#630 Fix chips')
  assert.equal(
    resourceFullLabel(resource({ provider: 'linear', title: 'ENG-12 Fix' })),
    'ENG-12 Fix',
  )
})

test('names every resource and every grouped terminal', () => {
  const terminals = ['a', 'b'].map((name) => ({ tabId: name, name }))

  assert.deepEqual(chipNames(resourceChips([resource({ number: 1 })], terminals)), [
    '#1 Fix chips',
    'a',
    'b',
  ])
})

test('a lone terminal keeps its own chip', () => {
  const chips = resourceChips([resource({})], [{ tabId: 't1', name: 'dev' }])

  assert.deepEqual(
    chips.map((chip) => chip.kind),
    ['resource', 'terminal'],
  )
})

test('several terminals share one chip after the links', () => {
  const terminals = ['a', 'b', 'c', 'd'].map((name) => ({ tabId: name, name }))
  const chips = resourceChips([resource({ id: 'p1' }), resource({ id: 'p2' })], terminals)

  assert.deepEqual(
    chips.map((chip) => chip.key),
    ['p1', 'p2', 'terminals'],
  )
  assert.deepEqual(chips[2], { kind: 'terminals', key: 'terminals', terminals })
})

test('shows every chip when they all fit', () => {
  assert.equal(fittingChipCount([40, 40, 40], 128, 4, 24), 3)
  assert.equal(fittingChipCount([], 100, 4, 24), 0)
})

test('leaves room for the overflow chip when some do not fit', () => {
  // 40 + 4 + 40 + 4 + 24 = 112 fits in 120; a third chip would not.
  assert.equal(fittingChipCount([40, 40, 40, 40], 120, 4, 24), 2)
  // The whole row is 128 wide, so 127 forces the overflow chip in.
  assert.equal(fittingChipCount([40, 40, 40], 127, 4, 24), 2)
})

test('a narrow row folds into "+N" alone, but a lone chip never becomes "+1"', () => {
  assert.equal(fittingChipCount([80, 40], 50, 4, 24), 0)
  assert.equal(fittingChipCount([80], 50, 4, 24), 1)
})

test('the row folds no narrower than its "+N" chip, or its only chip', () => {
  assert.equal(minimumRowWidth([44, 44, 30], 24), 24)
  assert.equal(minimumRowWidth([60], 24), 60)
  assert.equal(minimumRowWidth([], 24), 0)
})

test('two PRs and five terminals fold from the end as the titlebar narrows', () => {
  const terminals = [1, 2, 3, 4, 5].map((n) => ({ tabId: `t${String(n)}`, name: 'node' }))
  const chips = resourceChips(
    [resource({ id: 'p630', number: 630 }), resource({ id: 'p662', number: 662 })],
    terminals,
  )
  // "#630", "#662", the terminal ×5 chip, each with a border; gap 4; "+3" is 24.
  const widths = [44, 44, 34]
  const shown = (available: number) => fittingChipCount(widths, available, 4, 24)

  assert.deepEqual(
    chips.map((chip) => chip.kind),
    ['resource', 'resource', 'terminals'],
  )
  assert.equal(shown(400), 3)
  assert.equal(shown(130), 3)
  // The terminal group folds first: #630 #662 +1.
  assert.equal(shown(129), 2)
  assert.equal(shown(120), 2)
  // Then the PRs: #630 +2, and at the row's minimum, +3 alone.
  assert.equal(shown(119), 1)
  assert.equal(shown(minimumRowWidth(widths, 24)), 0)
})

test('an open PR says what holds it up; merged, closed and unblocked PRs say their state', () => {
  assert.equal(resourceStatus(resource({ health: 'checks_failed' })), 'open · checks failing')
  assert.equal(
    resourceStatus(resource({ health: 'changes_requested' })),
    'open · changes requested',
  )
  assert.equal(resourceStatus(resource({ health: 'conflict' })), 'open · merge conflict')
  assert.equal(resourceStatus(resource({ health: null })), 'open')
  assert.equal(resourceStatus(resource({})), 'open')
  // A stale health never outlives the merge.
  assert.equal(resourceStatus(resource({ state: 'merged', health: 'conflict' })), 'merged')
})

test('a PR tag keeps its GitHub state color whatever holds it up', () => {
  for (const health of [undefined, null, 'checks_failed', 'changes_requested', 'conflict'] as const)
    assert.equal(pullStateColor(resource({ health })), 'session-resource-open')
  assert.equal(pullStateColor(resource({ state: 'merged' })), 'session-resource-merged')
  assert.equal(pullStateColor(resource({ state: 'closed' })), 'session-resource-closed')
})

test('an open PR shows a separate mark for failing checks, requested changes or a conflict', () => {
  assert.deepEqual(resourceMark(resource({ health: 'checks_failed' })), {
    glyph: 'cross',
    color: 'session-resource-failing',
  })
  assert.deepEqual(resourceMark(resource({ health: 'changes_requested' })), {
    glyph: 'dot',
    color: 'session-resource-pending',
  })
  assert.deepEqual(resourceMark(resource({ health: 'conflict' })), {
    glyph: 'conflict',
    color: 'session-resource-pending',
  })
})

test('an unblocked, merged or closed PR, or a Linear issue, has no mark', () => {
  assert.equal(resourceMark(resource({})), null)
  assert.equal(resourceMark(resource({ health: null })), null)
  assert.equal(resourceMark(resource({ state: 'merged', health: 'checks_failed' })), null)
  assert.equal(resourceMark(resource({ state: 'closed', health: 'conflict' })), null)
  assert.equal(resourceMark(resource({ provider: 'linear', health: 'conflict' })), null)
})

test('a change is open, merged or closed, a completed issue counting as merged', () => {
  assert.equal(changeStatus(resource({ state: 'open' })), 'open')
  assert.equal(changeStatus(resource({ state: 'merged' })), 'merged')
  assert.equal(changeStatus(resource({ state: 'closed' })), 'closed')
  assert.equal(
    changeStatus(resource({ provider: 'linear', state: 'Done', stateType: 'completed' })),
    'merged',
  )
  assert.equal(
    changeStatus(resource({ provider: 'linear', state: 'Canceled', stateType: 'canceled' })),
    'closed',
  )
  assert.equal(
    changeStatus(resource({ provider: 'linear', state: 'In Progress', stateType: 'started' })),
    'open',
  )
  assert.equal(changeStatus(resource({ provider: 'slack', state: 'linked' })), 'open')
})
