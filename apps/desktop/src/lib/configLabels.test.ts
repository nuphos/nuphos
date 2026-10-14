import assert from 'node:assert/strict'
import { test } from 'node:test'

import { effortLabel, modelChoiceLabel } from './configLabels.ts'

test('a bare family name takes the version from its description', () => {
  assert.equal(
    modelChoiceLabel({ name: 'Opus', description: 'Opus 5.5 · Most capable' }),
    'Opus 5.5',
  )
  assert.equal(modelChoiceLabel({ name: 'Sonnet', description: 'sonnet 5.5' }), 'Sonnet 5.5')
  assert.equal(modelChoiceLabel({ name: 'Haiku', description: 'Haiku 4.5 · Fastest' }), 'Haiku 4.5')
})

test('names that carry a version, or descriptions without one, stay unchanged', () => {
  assert.equal(
    modelChoiceLabel({ name: 'Opus 5.5', description: 'For complex work and everyday tasks' }),
    'Opus 5.5',
  )
  assert.equal(modelChoiceLabel({ name: 'Opus', description: 'For complex work' }), 'Opus')
  assert.equal(modelChoiceLabel({ name: 'Opus', description: 'Opus is great' }), 'Opus')
  assert.equal(modelChoiceLabel({ name: 'Opus', description: 'Sonnet 5.5' }), 'Opus')
  assert.equal(modelChoiceLabel({ name: 'Opus' }), 'Opus')
  assert.equal(
    modelChoiceLabel({ name: 'GPT-6 Astra', description: 'GPT-6 Astra 2' }),
    'GPT-6 Astra',
  )
})

test('known effort values read naturally; unknown ones keep the runtime name', () => {
  assert.equal(effortLabel({ value: 'xhigh', name: 'Xhigh' }), 'Extra high')
  assert.equal(effortLabel({ value: 'low', name: 'Low' }), 'Low')
  assert.equal(effortLabel({ value: 'max', name: 'Max' }), 'Max')
  assert.equal(effortLabel({ value: 'ultra', name: 'Ultra' }), 'Ultra')
  assert.equal(effortLabel({ value: 'default', name: 'Default' }), 'Default')
})
