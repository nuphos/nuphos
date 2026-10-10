import { expect, test } from 'bun:test'

import { createRuntimeModelCatalog } from './runtime-model-cache'

import type { RuntimeInstance } from './runtime-instances'

function instance(id: string): RuntimeInstance {
  return { id, label: id, provider: 'codex', status: 'active', kind: 'managed', createdAt: '' }
}

test('model discovery deduplicates concurrent requests, isolates workspaces, and keeps nothing', async () => {
  const calls: string[] = []
  const catalog = createRuntimeModelCatalog({
    requireInstance: (_team, id) => Promise.resolve(instance(id)),
    discover: async (team) => {
      calls.push(team)
      await Promise.resolve()

      return { models: [{ id: `${team}-model`, name: team }] }
    },
  })
  const [first, second] = await Promise.all([catalog('one', 'same'), catalog('one', 'same')])

  expect(first).toEqual(second)
  expect(calls).toEqual(['one'])
  expect((await catalog('two', 'same')).models[0]?.id).toBe('two-model')
  await catalog('one', 'same')
  expect(calls).toEqual(['one', 'two', 'one'])
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
  })

  await expect(catalog('one', 'runtime')).rejects.toThrow('Could not load models')
  expect((await catalog('one', 'runtime')).models).toEqual([])
  expect((await catalog('one', 'runtime')).models[0]?.id).toBe('available')
  expect(attempts).toBe(3)
})

test('model discovery cannot bypass runtime availability or workspace authorization', async () => {
  let enabled = true
  const catalog = createRuntimeModelCatalog({
    requireInstance: (team, id) => {
      if (team !== 'one') return Promise.reject(new Error('not found'))

      return Promise.resolve({ ...instance(id), status: enabled ? 'active' : 'disabled' })
    },
    discover: () => Promise.resolve({ models: [{ id: 'model', name: 'Model' }] }),
  })

  await catalog('one', 'runtime')
  enabled = false
  await expect(catalog('one', 'runtime')).rejects.toThrow('Connect and enable')
  await expect(catalog('two', 'runtime')).rejects.toThrow('not found')
})

test('capabilities are discovered for each selected model and runtime default', async () => {
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
  })

  expect((await catalog('team', 'runtime', 'fast-model')).controls?.fast).toBe(true)
  expect((await catalog('team', 'runtime', 'standard')).controls?.fast).toBe(false)
  expect((await catalog('team', 'runtime')).controls?.modelId).toBe('default-model')
  expect(calls).toEqual(['fast-model', 'standard', undefined])
})

test('a runtime runs one discovery at a time and refuses a long queue', async () => {
  let running = 0
  let peak = 0
  const catalog = createRuntimeModelCatalog({
    requireInstance: (_team, id) => Promise.resolve(instance(id)),
    discover: async (_team, _instance, model) => {
      peak = Math.max(peak, ++running)
      await new Promise((resolve) => setTimeout(resolve, 1))
      running--

      return { models: [{ id: model ?? 'default', name: 'Model' }] }
    },
  })
  const reads = ['a', 'b', 'c', 'd'].map((model) => catalog('team', 'runtime', model))

  await expect(catalog('team', 'runtime', 'e')).rejects.toThrow('busy')
  expect((await Promise.all(reads)).map((read) => read.models[0]?.id)).toEqual(['a', 'b', 'c', 'd'])
  expect(peak).toBe(1)
  expect((await catalog('team', 'runtime', 'e')).models[0]?.id).toBe('e')
})
