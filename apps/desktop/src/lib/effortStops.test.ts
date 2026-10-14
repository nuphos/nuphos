import assert from 'node:assert/strict'
import { test } from 'node:test'

import { effortResetValue, effortStops, stopFraction } from './effortStops.ts'

const claude = ['default', 'low', 'medium', 'high', 'xhigh', 'max'].map((value) => ({
  value,
  name: value,
}))
const codex = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].map((value) => ({
  value,
  name: value,
}))

test('the runtime default is not a stop; every other level is, in order', () => {
  assert.deepEqual(
    effortStops(claude).map((stop) => stop.value),
    ['low', 'medium', 'high', 'xhigh', 'max'],
  )
  assert.equal(effortStops(codex).length, 6)
})

test('reset returns to the runtime default, else the level the chat started on', () => {
  assert.equal(effortResetValue(claude, 'high'), 'default')
  assert.equal(effortResetValue(codex, 'medium'), 'medium')
  assert.equal(effortResetValue(codex, 'gone'), undefined)
  assert.equal(effortResetValue(codex), undefined)
})

test('stops spread evenly from the first to the last', () => {
  assert.equal(stopFraction(5, 0), 0)
  assert.equal(stopFraction(5, 3), 0.75)
  assert.equal(stopFraction(5, 4), 1)
  assert.equal(stopFraction(5, 9), 1)
  assert.equal(stopFraction(1, 0), 0)
  assert.equal(stopFraction(5, -1), 0)
})
