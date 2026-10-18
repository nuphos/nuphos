import assert from 'node:assert/strict'
import { test } from 'node:test'

import { effortResetValue, effortStops, resolvedEffort, stopFraction } from './effortStops.ts'

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

test('reset returns to the runtime default, and there is none without one', () => {
  assert.equal(effortResetValue(claude), 'default')
  assert.equal(effortResetValue(codex), undefined)
})

test("Claude's default resolves to the level it names; anything else stays as reported", () => {
  const described = claude.map((choice) =>
    choice.value === 'default' ? { ...choice, description: 'medium' } : choice,
  )

  assert.equal(resolvedEffort(described, 'default'), 'medium')
  assert.equal(resolvedEffort(described, 'high'), 'high')
  assert.equal(resolvedEffort(claude, 'default'), 'default')
  assert.equal(resolvedEffort(codex, 'xhigh'), 'xhigh')
})

test('stops spread evenly from the first to the last', () => {
  assert.equal(stopFraction(5, 0), 0)
  assert.equal(stopFraction(5, 3), 0.75)
  assert.equal(stopFraction(5, 4), 1)
  assert.equal(stopFraction(5, 9), 1)
  assert.equal(stopFraction(1, 0), 0)
  assert.equal(stopFraction(5, -1), 0)
})
