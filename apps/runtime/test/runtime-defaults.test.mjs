import assert from 'node:assert/strict'
import { test } from 'node:test'

import { nuphosApplyRuntimeDefaults, patchRuntimeDefaults } from '../image/runtime-defaults.mjs'

const option = (id, currentValue, values) => ({
  id,
  name: id,
  currentValue,
  options: values.map((value) => ({ name: value, value })),
})
const params = (defaults) => ({ _meta: { 'ai.nuphos/runtimeDefaults': defaults } })

test('native defaults apply model before model-dependent fast and effort choices', async () => {
  const writes = []
  const model = option('model', 'a', ['a', 'b'])
  const fast = option('fast-mode', 'off', ['off', 'on'])
  const effort = option('reasoning_effort', 'low', ['low', 'high'])
  let options = [model]
  const result = await nuphosApplyRuntimeDefaults(
    {
      setSessionConfigOption: async (selection) => {
        writes.push(selection)
        if (selection.configId === 'model')
          options = [{ ...model, currentValue: 'b' }, fast, effort]
        options = options.map((entry) =>
          entry.id === selection.configId ? { ...entry, currentValue: selection.value } : entry,
        )

        return { configOptions: options }
      },
    },
    params({ model: 'b', fast: 'on', effort: 'high' }),
    { sessionId: 's', configOptions: options, models: { currentModelId: 'a' } },
  )

  assert.deepEqual(writes, [
    { sessionId: 's', configId: 'model', value: 'b' },
    { sessionId: 's', configId: 'fast-mode', value: 'on' },
    { sessionId: 's', configId: 'reasoning_effort', value: 'high' },
  ])
  assert.equal(result.models.currentModelId, 'b')
  assert.deepEqual(
    result.configOptions.map((entry) => entry.currentValue),
    ['b', 'on', 'high'],
  )
})

test('omitted defaults preserve native behavior, and already selected values require no write', async () => {
  const response = { sessionId: 's', configOptions: [option('fast_mode', 'off', ['off', 'on'])] }

  assert.equal(await nuphosApplyRuntimeDefaults({}, {}, response), response)
  assert.equal(await nuphosApplyRuntimeDefaults({}, params({}), response), response)
  assert.deepEqual(
    await nuphosApplyRuntimeDefaults({}, params({ fast: 'off' }), response),
    response,
  )
})

test('fast off is explicitly applied and Claude effort IDs are supported', async () => {
  let options = [
    option('fast-mode', 'on', ['on', 'off']),
    option('effort', 'medium', ['medium', 'max']),
  ]
  const result = await nuphosApplyRuntimeDefaults(
    {
      setSessionConfigOption: async ({ configId, value }) => {
        options = options.map((entry) =>
          entry.id === configId ? { ...entry, currentValue: value } : entry,
        )

        return { configOptions: options }
      },
    },
    params({ fast: 'off', effort: 'max' }),
    { sessionId: 's', configOptions: options },
  )

  assert.deepEqual(
    result.configOptions.map((entry) => entry.currentValue),
    ['off', 'max'],
  )
})

test('invalid, unavailable, rejected, and unacknowledged defaults fail before any prompt', async () => {
  const response = { sessionId: 's', configOptions: [option('model', 'a', ['a', 'b'])] }

  for (const defaults of [{ model: 'missing' }, { effort: 'high' }, { fast: 'on' }]) {
    await assert.rejects(
      nuphosApplyRuntimeDefaults({}, params(defaults), response),
      /Settings → Agent/,
    )
  }
  await assert.rejects(
    nuphosApplyRuntimeDefaults(
      {
        setSessionConfigOption: async () => {
          throw new Error('Rejected')
        },
      },
      params({ model: 'b' }),
      response,
    ),
    /Rejected/,
  )
  await assert.rejects(
    nuphosApplyRuntimeDefaults(
      { setSessionConfigOption: async () => response },
      params({ model: 'b' }),
      response,
    ),
    /did not accept/,
  )
})

test('patch wraps only native session creation and leaves loads and session isolation intact', async () => {
  const source = `#!/usr/bin/env node
class Agent {
    async newSession(params) { return { sessionId: params.id, configOptions: [{ id: 'model', currentValue: 'a', options: [{ value: 'a' }, { value: 'b' }] }] }; }
    async setSessionConfigOption(params) { return { configOptions: [{ id: 'model', currentValue: params.value, options: [{ value: 'a' }, { value: 'b' }] }] }; }
    async loadSession(params) { return 'loaded without applying defaults'; }
    async resumeSession(params) { return 'resumed without applying defaults'; }
  }`
  const patched = `${patchRuntimeDefaults(source)}\nexport { Agent }`
  const module = await import(`data:text/javascript,${encodeURIComponent(patched)}`)
  const agent = new module.Agent()
  const a = await agent.newSession({ id: 'a', ...params({ model: 'b' }) })
  const b = await agent.newSession({ id: 'b' })

  assert.equal(a.configOptions[0].currentValue, 'b')
  assert.equal(b.configOptions[0].currentValue, 'a')
  assert.equal(
    await agent.loadSession(params({ model: 'invalid' })),
    'loaded without applying defaults',
  )
  assert.equal(
    await agent.resumeSession(params({ model: 'invalid' })),
    'resumed without applying defaults',
  )
  assert.throws(() => patchRuntimeDefaults('unexpected adapter'), /exactly one/)
})
