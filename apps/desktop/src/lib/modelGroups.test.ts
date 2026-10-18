import assert from 'node:assert/strict'
import { test } from 'node:test'

import { claudeModelGroups, isClaudeCatalog } from './modelGroups.ts'

const names = [
  'Opus 5.5',
  'Fable 5.1',
  'Sonnet 5.5',
  'Haiku 5.5',
  'Haiku 4.5',
  'Sonnet 5',
  'Opus 5',
  'Fable 5',
  'Opus 4.8',
  'Opus 4.7',
  'Opus 4.6',
  'Sonnet 4.6',
]
const claude = names.map((name) => ({ value: name.toLowerCase().replace(' ', '-'), name }))

test('the newest model of each family leads, in family order; the rest stay in runtime order', () => {
  const { latest, older } = claudeModelGroups(claude, (choice) => choice.name)

  assert.deepEqual(
    latest.map((choice) => choice.name),
    ['Opus 5.5', 'Fable 5.1', 'Sonnet 5.5', 'Haiku 5.5'],
  )
  assert.deepEqual(
    older.map((choice) => choice.name),
    [
      'Haiku 4.5',
      'Sonnet 5',
      'Opus 5',
      'Fable 5',
      'Opus 4.8',
      'Opus 4.7',
      'Opus 4.6',
      'Sonnet 4.6',
    ],
  )
})

test('versions compare numerically, not by list position', () => {
  const { latest, older } = claudeModelGroups(
    [
      { value: 'a', name: 'Opus 4.10' },
      { value: 'b', name: 'Opus 4.9' },
      { value: 'c', name: 'Opus 5' },
      { value: 'd', name: 'Custom gateway model' },
    ],
    (choice) => choice.name,
  )

  assert.deepEqual(
    latest.map((choice) => choice.value),
    ['c'],
  )
  assert.deepEqual(
    older.map((choice) => choice.value),
    ['a', 'b', 'd'],
  )
})

test('bare family names, as an older backend sends them, still lead their families', () => {
  const bare = ['Opus', 'Fable', 'Sonnet', 'Haiku', 'Haiku 4.5', 'Opus 4.8'].map((name) => ({
    value: name.toLowerCase().replace(' ', '-'),
    name,
  }))
  const { latest, older } = claudeModelGroups(bare, (choice) => choice.name)

  assert.deepEqual(
    latest.map((choice) => choice.name),
    ['Opus', 'Fable', 'Sonnet', 'Haiku'],
  )
  assert.deepEqual(
    older.map((choice) => choice.name),
    ['Haiku 4.5', 'Opus 4.8'],
  )
})

test('Claude catalogs are told apart from Codex ones by their model ids', () => {
  assert.equal(isClaudeCatalog([{ value: 'opus', name: 'Opus 5.5' }]), true)
  assert.equal(isClaudeCatalog([{ value: 'claude-opus-4-6', name: 'Opus 4.6' }]), true)
  assert.equal(isClaudeCatalog([{ value: 'gpt-6.1-sol', name: 'GPT-6.1-Sol' }]), false)
})
