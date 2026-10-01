import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canonicalCycle,
  partitionTargets,
  canonicalCycles,
  compareToBaseline,
  parseTsConfig,
} from './check-import-cycles.mjs'

test('a cycle rotates to a stable starting point', () => {
  assert.deepEqual(canonicalCycle(['b.ts', 'c.ts', 'a.ts']), ['a.ts', 'b.ts', 'c.ts'])
  assert.deepEqual(canonicalCycle(['a.ts']), ['a.ts'])
})

test('the same cycle discovered from a different entry point compares equal', () => {
  const one = canonicalCycles([['routes/agent.ts', 'lib/tools.ts', 'lib/cost.ts']])
  const other = canonicalCycles([['lib/cost.ts', 'routes/agent.ts', 'lib/tools.ts']])

  assert.deepEqual(one, other)
})

test('cycles are sorted so the baseline file has a stable order', () => {
  assert.deepEqual(
    canonicalCycles([
      ['z.ts', 'y.ts'],
      ['a.ts', 'b.ts'],
    ]),
    ['a.ts -> b.ts', 'y.ts -> z.ts'],
  )
})

test('an unrecorded cycle is reported as new', () => {
  const diff = compareToBaseline(['a -> b', 'c -> d'], ['a -> b'])

  assert.deepEqual(diff.added, ['c -> d'])
  assert.deepEqual(diff.removed, [])
})

test('a recorded cycle that is gone is reported so the baseline can tighten', () => {
  const diff = compareToBaseline(['a -> b'], ['a -> b', 'c -> d'])

  assert.deepEqual(diff.added, [])
  assert.deepEqual(diff.removed, ['c -> d'])
})

test('an unchanged set drifts in neither direction', () => {
  const diff = compareToBaseline(['a -> b'], ['a -> b'])

  assert.deepEqual(diff, { added: [], removed: [] })
})

test('tsconfig files may carry comments and trailing commas', () => {
  const config = parseTsConfig(
    'tsconfig.json',
    '{\n  // JSONC, not JSON\n  "compilerOptions": { "baseUrl": ".", },\n}',
  )

  assert.deepEqual(config, { compilerOptions: { baseUrl: '.' } })
})

const TWO_ROOTS = [{ name: 'desktop', roots: ['apps/desktop/src', 'apps/desktop/electron'] }]

test('a target whose roots all exist is measurable', () => {
  const { present, skipped } = partitionTargets(TWO_ROOTS, () => true)

  assert.deepEqual(
    present.map((t) => t.name),
    ['desktop'],
  )
  assert.deepEqual(skipped, [])
})

test('a target with no roots at all is skipped, not failed', () => {
  // The published open-source snapshot drops apps/admin. Analysing it anyway
  // returns no cycles, which the ratchet would read as the baseline being stale.
  const { present, skipped } = partitionTargets(TWO_ROOTS, () => false)

  assert.deepEqual(present, [])
  assert.deepEqual(skipped, ['desktop'])
})

test('a target missing only some roots is a mistake, and says which', () => {
  assert.throws(
    () => partitionTargets(TWO_ROOTS, (root) => root === 'apps/desktop/src'),
    /desktop: roots missing from an otherwise present target: apps\/desktop\/electron/,
  )
})

test('each target is judged on its own roots', () => {
  const targets = [
    { name: 'backend', roots: ['apps/backend/src'] },
    { name: 'admin', roots: ['apps/admin/app', 'apps/admin/lib'] },
  ]
  const { present, skipped } = partitionTargets(targets, (root) => root.startsWith('apps/backend/'))

  assert.deepEqual(
    present.map((t) => t.name),
    ['backend'],
  )
  assert.deepEqual(skipped, ['admin'])
})
