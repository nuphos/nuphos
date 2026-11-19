import assert from 'node:assert/strict'
import { test } from 'node:test'

import { modelHint, modelName } from './modelSelectorParts.ts'

import type { SessionConfigOption } from '../../../api/session-config-types.ts'

const model: SessionConfigOption = {
  id: 'model',
  name: 'Model',
  kind: 'model',
  currentValue: 'default',
  options: [
    { value: 'default', name: 'Default' },
    { value: 'sonnet', name: 'Sonnet' },
  ],
}

test('an acknowledged Default without a concrete model keeps the runtime label', () => {
  assert.equal(modelName(model), 'Default')
  assert.equal(
    modelName({ ...model, options: [{ value: 'default', name: 'Default (recommended)' }] }),
    'Default (recommended)',
  )
})

test('a Default that identifies its concrete model still shows that model', () => {
  assert.equal(
    modelName({
      ...model,
      options: [
        { value: 'default', name: 'Default', description: 'Uses Sonnet' },
        { value: 'sonnet', name: 'Sonnet' },
      ],
    }),
    'Sonnet',
  )
})

test('concrete and unlisted current models retain their acknowledged names', () => {
  assert.equal(modelName({ ...model, currentValue: 'sonnet' }), 'Sonnet')
  assert.equal(modelName({ ...model, currentValue: 'new-model' }), 'new-model')
})

// #3807: an empty model list said "send a message to start"; it now says why there is none.
test('a picker with nothing to set says why, and nothing without a reason', () => {
  assert.equal(
    modelHint('dormant', false, false, false, 'unreported'),
    'This computer hasn’t reported its models yet. Try again in a moment.',
  )
  assert.equal(
    modelHint('ready', false, false, false, 'signed-out'),
    'This agent is signed out on its computer. Sign in there to choose a model.',
  )
  assert.equal(
    modelHint('dormant', false, false, false, 'undiscovered'),
    'Couldn’t load this runtime’s models. Check its sign-in and update it, then try again.',
  )
  assert.equal(modelHint('dormant', false, false, false), undefined, 'no reason, no hint')
  // Grok lists effort and no model: that effort applies when the session starts.
  assert.equal(modelHint('dormant', false, false, true, 'unreported'), undefined)
  assert.equal(modelHint('dormant', true, false, false, 'unreported'), undefined)
})
