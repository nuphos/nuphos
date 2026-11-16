import assert from 'node:assert/strict'
import { test } from 'node:test'

import { rowExpansion, toggleRowExpansion } from './row-expand.ts'

import type { RowExpandInput } from './row-expand.ts'

const base: RowExpandInput = {
  hasChildren: false,
  folded: false,
  running: false,
  hasDone: false,
  doneOpen: false,
}

function click(row: RowExpandInput, foldSet = row.folded): string[] {
  const calls: string[] = []

  toggleRowExpansion(row, {
    foldSet,
    toggleFold: () => calls.push('fold'),
    toggleDone: () => calls.push('done'),
  })

  return calls
}

test('a row without children has nothing to expand', () => {
  assert.equal(rowExpansion(base), 'none')
  assert.deepEqual(click(base), [])
})

test('a row with only finished children opens and closes its done group', () => {
  const closed = { ...base, hasDone: true }

  assert.equal(rowExpansion(closed), 'partial')
  assert.deepEqual(click(closed), ['done'])

  const open = { ...closed, hasChildren: true, doneOpen: true }

  assert.equal(rowExpansion(open), 'expanded')
  assert.deepEqual(click(open), ['done'])
})

test('expanding also clears a thread fold set at rest', () => {
  assert.deepEqual(click({ ...base, hasDone: true }, true), ['fold', 'done'])
})

test('running and finished children expand together and collapse with the fold', () => {
  const partial = { ...base, hasChildren: true, running: true, hasDone: true }

  assert.equal(rowExpansion(partial), 'partial')
  assert.deepEqual(click(partial), ['done'])

  const expanded = { ...partial, doneOpen: true }

  assert.equal(rowExpansion(expanded), 'expanded')
  assert.deepEqual(click(expanded), ['fold'])

  const collapsed = { ...expanded, folded: true }

  assert.equal(rowExpansion(collapsed), 'collapsed')
  assert.deepEqual(click(collapsed), ['fold'])
})

test('a folded row with a closed done group opens both', () => {
  const row = { ...base, hasChildren: true, running: true, hasDone: true, folded: true }

  assert.deepEqual(click(row), ['fold', 'done'])
})

test('a row with only running children toggles its thread fold', () => {
  const open = { ...base, hasChildren: true, running: true }

  assert.equal(rowExpansion(open), 'expanded')
  assert.deepEqual(click(open), ['fold'])
  assert.deepEqual(click({ ...open, folded: true }), ['fold'])
})
