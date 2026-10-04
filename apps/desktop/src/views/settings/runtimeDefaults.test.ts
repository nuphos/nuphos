import assert from 'node:assert/strict'
import { test } from 'node:test'

import { resolvedRuntimeDefaults, runtimeDefaultsError } from './runtimeDefaults.ts'

const controls = {
  modelId: 'model-a',
  effort: [
    { value: 'default', name: 'Default' },
    { value: 'medium', name: 'Medium' },
    { value: 'high', name: 'High' },
  ],
  defaultEffort: 'high',
  fast: true,
  defaultFast: 'off' as const,
}

test('initial settings resolve to concrete model, effort and Fast values', () => {
  assert.deepEqual(resolvedRuntimeDefaults({}, controls), {
    model: 'model-a',
    effort: 'high',
    fast: 'off',
  })
  assert.equal(
    resolvedRuntimeDefaults({ effort: 'default' }, { ...controls, defaultEffort: 'default' })
      .effort,
    'medium',
  )
})

test('changing model starts from that model’s controls without previous effort or Fast', () => {
  const next = resolvedRuntimeDefaults(
    { model: 'model-b' },
    {
      modelId: 'model-b',
      effort: [{ value: 'low', name: 'Low' }],
      fast: false,
    },
  )

  assert.deepEqual(next, { model: 'model-b', effort: 'low' })
  assert.equal(
    runtimeDefaultsError(next, {
      modelId: 'model-b',
      effort: [{ value: 'low', name: 'Low' }],
      fast: false,
    }),
    null,
  )
})

test('explicit saved settings remain visible for validation, and pending controls invent nothing', () => {
  const saved = { model: 'model-a', effort: 'ultra', fast: 'on' as const }

  assert.deepEqual(resolvedRuntimeDefaults(saved, controls), saved)
  assert.equal(runtimeDefaultsError(saved, controls), 'Choose a supported effort.')
  assert.deepEqual(resolvedRuntimeDefaults({}, undefined), {})
})
