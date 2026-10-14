import { expect, test } from 'bun:test'

import { resolveDefaultModel } from './runtime-default-model'

const controls = { modelId: 'default', effort: [{ value: 'high', name: 'High' }], fast: false }

test('a token-signed runtime names its default by family; the version stays in the description', () => {
  expect(
    resolveDefaultModel({
      models: [
        { id: 'default', name: 'Default (recommended)', description: 'Opus' },
        { id: 'opus', name: 'Opus', description: 'Opus 5.5 · Best for everyday, complex tasks' },
        { id: 'sonnet', name: 'Sonnet', description: 'Sonnet 5.5 · Efficient for routine tasks' },
      ],
      controls,
    }),
  ).toEqual({
    models: [
      { id: 'opus', name: 'Opus', description: 'Opus 5.5 · Best for everyday, complex tasks' },
      { id: 'sonnet', name: 'Sonnet', description: 'Sonnet 5.5 · Efficient for routine tasks' },
    ],
    controls: { ...controls, modelId: 'opus' },
  })
})

test('a subscription runtime names its default by versioned name', () => {
  const resolved = resolveDefaultModel({
    models: [
      { id: 'default', name: 'Default (recommended)', description: 'Opus 5.5' },
      { id: 'opus', name: 'Opus 5.5', description: 'For complex work' },
    ],
    controls: { ...controls, modelId: 'opus' },
  })

  expect(resolved.models.map((model) => model.id)).toEqual(['opus'])
  expect(resolved.controls?.modelId).toBe('opus')
})

test('a default that matches no offered model stays as offered', () => {
  const catalog = {
    models: [
      { id: 'default', name: 'Default (recommended)', description: 'claude-opus-9' },
      { id: 'sonnet', name: 'Sonnet' },
    ],
    controls,
  }

  expect(resolveDefaultModel(catalog)).toBe(catalog)
  expect(resolveDefaultModel({ models: [{ id: 'default', name: 'Default' }] }).models).toHaveLength(
    1,
  )
})
