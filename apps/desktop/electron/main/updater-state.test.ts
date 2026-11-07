import assert from 'node:assert/strict'
import { test } from 'node:test'

import { acceptsUpdaterState } from './updater-state.ts'

import type { UpdaterState } from './updater-state.ts'

const ready = (version: string): UpdaterState => ({ kind: 'ready', version })
const downloading: UpdaterState = {
  kind: 'downloading',
  version: '0.110.0',
  transferred: 0,
  total: 0,
  bytesPerSecond: 0,
}

test('before an update is ready, every state passes', () => {
  assert.equal(acceptsUpdaterState({ kind: 'idle' }, { kind: 'checking' }), true)
  assert.equal(acceptsUpdaterState({ kind: 'checking' }, downloading), true)
  assert.equal(acceptsUpdaterState(downloading, ready('0.110.0')), true)
})

test('a ready update stays ready while later checks run', () => {
  for (const next of [
    { kind: 'checking' },
    { kind: 'up-to-date' },
    { kind: 'error' },
    downloading,
  ] as UpdaterState[]) {
    assert.equal(acceptsUpdaterState(ready('0.109.0'), next), false)
  }
})

test('a newer download replaces the ready one; the same version does not', () => {
  assert.equal(acceptsUpdaterState(ready('0.109.0'), ready('0.110.0')), true)
  assert.equal(acceptsUpdaterState(ready('0.109.0'), ready('0.109.0')), false)
})
