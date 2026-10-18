import assert from 'node:assert/strict'
import { test } from 'node:test'

import { concreteModelChoices, offeredDefaultModel } from './modelChoices.ts'

test('runtime Default aliases resolve to an advertised real model without appearing as choices', () => {
  const result = concreteModelChoices(
    [
      { id: 'default', name: 'Default', description: 'Uses Sonnet' },
      { id: 'sonnet', name: 'Sonnet' },
      { id: 'opus', name: 'Opus' },
    ],
    'default',
  )

  assert.equal(result.current, 'sonnet')
  assert.deepEqual(
    result.choices.map((model) => model.name),
    ['Sonnet', 'Opus'],
  )
})

test('unknown aliases never invent a selected model or leave Default as an option', () => {
  const result = concreteModelChoices(
    [
      { id: 'default', name: 'Default' },
      { id: 'model', name: 'Model A' },
    ],
    'default',
  )

  assert.equal(result.current, undefined)
  assert.deepEqual(
    result.choices.map((model) => model.id),
    ['model'],
  )
  assert.equal(concreteModelChoices(result.choices, 'model').current, 'model')
})

test('a Default row appears only for a default the runtime offers', () => {
  assert.equal(
    offeredDefaultModel([
      { value: 'gpt-6.1-sol', name: 'GPT-6.1-Sol' },
      { value: 'gpt-6-astra', name: 'GPT-6-Astra' },
    ]),
    undefined,
  )
  assert.equal(
    offeredDefaultModel([
      { value: 'default', name: 'Default (recommended)' },
      { value: 'opus', name: 'Opus 5.5' },
    ])?.value,
    'default',
  )
})
