import { expect, test } from 'bun:test'

import { createRuntimeModelCatalog } from './runtime-model-cache'

import type { RuntimeInstance } from './runtime-instances'

function instance(id: string): RuntimeInstance {
  return { id, label: id, provider: 'codex', status: 'active', kind: 'managed', createdAt: '' }
}

test('model discovery deduplicates concurrent requests, isolates workspaces, and expires choices', async () => {
  let now = 0
  const calls: string[] = []
  const catalog = createRuntimeModelCatalog({
    requireInstance: (_team, id) => Promise.resolve(instance(id)),
    discover: async (team) => {
      calls.push(team)
      await Promise.resolve()

      return { models: [{ id: `${team}-model`, name: team }] }
    },
    now: () => now,
  })
  const [first, second] = await Promise.all([catalog('one', 'same'), catalog('one', 'same')])

  expect(first).toEqual(second)
  expect(calls).toEqual(['one'])
  expect((await catalog('two', 'same')).models[0]?.id).toBe('two-model')
  await catalog('one', 'same')
  expect(calls).toEqual(['one', 'two'])
  now = 5 * 60_000 + 1
  await catalog('one', 'same')
  expect(calls).toEqual(['one', 'two', 'one'])
})

test('a sign-in drops only that agent’s cached models', async () => {
  const calls: string[] = []
  const catalog = createRuntimeModelCatalog({
    requireInstance: (_team, id) => Promise.resolve(instance(id)),
    discover: (_team, agent, model) => {
      calls.push(`${agent.id}:${model ?? ''}`)

      return Promise.resolve({
        models: [{ id: 'm', name: 'M' }],
        controls: { modelId: 'm', fast: false, effort: [] },
      })
    },
    now: () => 0,
  })

  await Promise.all([catalog('team', 'a'), catalog('team', 'a', 'm'), catalog('team', 'ab')])
  catalog.forget('team', 'a')
  await Promise.all([catalog('team', 'a'), catalog('team', 'a', 'm'), catalog('team', 'ab')])
  expect(calls).toEqual(['a:', 'a:m', 'ab:', 'a:', 'a:m'])
})

test('failed and empty discoveries are retryable without leaking diagnostics', async () => {
  let attempts = 0
  const catalog = createRuntimeModelCatalog({
    requireInstance: (_team, id) => Promise.resolve(instance(id)),
    discover: () => {
      attempts++
      if (attempts === 1) return Promise.reject(new Error('private provider diagnostic'))

      return Promise.resolve({
        models: attempts === 2 ? [] : [{ id: 'available', name: 'Available' }],
      })
    },
    now: () => 0,
  })

  await expect(catalog('one', 'runtime')).rejects.toThrow('Could not load models')
  expect((await catalog('one', 'runtime')).models).toEqual([])
  expect((await catalog('one', 'runtime')).models[0]?.id).toBe('available')
  expect(attempts).toBe(3)
})

test('cached models cannot bypass runtime availability or workspace authorization', async () => {
  let enabled = true
  const catalog = createRuntimeModelCatalog({
    requireInstance: (team, id) => {
      if (team !== 'one') return Promise.reject(new Error('not found'))

      return Promise.resolve({ ...instance(id), status: enabled ? 'active' : 'disabled' })
    },
    discover: () => Promise.resolve({ models: [{ id: 'model', name: 'Model' }] }),
    now: () => 0,
  })

  await catalog('one', 'runtime')
  enabled = false
  await expect(catalog('one', 'runtime')).rejects.toThrow('Connect and enable')
  await expect(catalog('two', 'runtime')).rejects.toThrow('not found')
})

test('capabilities are cached separately for each selected model and runtime default', async () => {
  const calls: (string | undefined)[] = []
  const catalog = createRuntimeModelCatalog({
    requireInstance: (_team, id) => Promise.resolve(instance(id)),
    discover: (_team, _instance, model) => {
      calls.push(model)

      return Promise.resolve({
        models: [{ id: 'model', name: 'Model' }],
        controls: { modelId: model ?? 'default-model', effort: [], fast: model === 'fast-model' },
      })
    },
    now: () => 0,
  })

  expect((await catalog('team', 'runtime', 'fast-model')).controls?.fast).toBe(true)
  expect((await catalog('team', 'runtime', 'standard')).controls?.fast).toBe(false)
  expect((await catalog('team', 'runtime')).controls?.modelId).toBe('default-model')
  await catalog('team', 'runtime', 'fast-model')
  expect(calls).toEqual(['fast-model', 'standard', undefined])
})
