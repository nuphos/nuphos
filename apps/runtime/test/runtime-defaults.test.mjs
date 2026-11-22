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

test("a default the agent does not offer leaves a new session on the agent's own choice", async () => {
  const response = { sessionId: 's', configOptions: [option('model', 'a', ['a', 'b'])] }

  for (const defaults of [{ model: 'missing' }, { effort: 'high' }, { fast: 'on' }])
    assert.deepEqual(await nuphosApplyRuntimeDefaults({}, params(defaults), response), response)

  // A saved xhigh pick, on a model whose efforts stop at high: the model applies, the
  // effort stays the model's own, and the session opens.
  let options = [option('model', 'a', ['a', 'b'])]
  const result = await nuphosApplyRuntimeDefaults(
    {
      setSessionConfigOption: async ({ value }) => {
        options = [
          option('model', value, ['a', 'b']),
          option('reasoning_effort', 'medium', ['low', 'medium', 'high']),
        ]

        return { configOptions: options }
      },
    },
    params({ model: 'b', effort: 'xhigh' }),
    { sessionId: 's', configOptions: options },
  )

  assert.deepEqual(
    result.configOptions.map((entry) => entry.currentValue),
    ['b', 'medium'],
  )
  // An agent that answers but keeps its own value: the session opens on that value.
  assert.deepEqual(
    await nuphosApplyRuntimeDefaults(
      { setSessionConfigOption: async () => response },
      params({ model: 'b' }),
      response,
    ),
    response,
  )
})

test('a rejected default fails before any prompt', async () => {
  const response = { sessionId: 's', configOptions: [option('model', 'a', ['a', 'b'])] }

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
})

test("a loaded or resumed session takes the conversation's stored settings, not only a new one", async () => {
  // The agent restores whatever its own record says: a switch to b that no turn
  // followed is not on record, so the restored session comes back on a.
  const source = `#!/usr/bin/env node
class Agent {
    model = {}
    config(id) { return [{ id: 'model', currentValue: this.model[id] ?? 'a', options: [{ value: 'a' }, { value: 'b' }] }]; }
    async newSession(params) { return { sessionId: params.id, configOptions: this.config(params.id) }; }
    setter = 'acknowledges'
    async setSessionConfigOption(params) {
      if (this.setter === 'rejects') throw new Error('set_config_option rejected');
      if (this.setter === 'acknowledges') this.model[params.sessionId] = params.value;
      return { configOptions: this.config(params.sessionId) };
    }
    async loadSession(params) { return { configOptions: this.config(params.sessionId) }; }
    async resumeSession(params) { return { configOptions: this.config(params.sessionId) }; }
  }`
  const patched = `${patchRuntimeDefaults(source)}\nexport { Agent }`
  const module = await import(`data:text/javascript,${encodeURIComponent(patched)}`)
  const agent = new module.Agent()
  const a = await agent.newSession({ id: 'a', ...params({ model: 'b' }) })
  const b = await agent.newSession({ id: 'b' })

  assert.equal(a.configOptions[0].currentValue, 'b')
  assert.equal(b.configOptions[0].currentValue, 'a')

  const loaded = await agent.loadSession({ sessionId: 'c', ...params({ model: 'b' }) })
  const resumed = await agent.resumeSession({ sessionId: 'd', ...params({ model: 'b' }) })

  assert.equal(loaded.configOptions[0].currentValue, 'b')
  assert.equal(agent.model.c, 'b')
  assert.equal(resumed.configOptions[0].currentValue, 'b')
  // A stored setting the runtime no longer offers leaves the restored session as it is.
  const kept = await agent.loadSession({ sessionId: 'e', ...params({ model: 'retired' }) })

  assert.equal(kept.configOptions[0].currentValue, 'a')
  // So does one the agent answers without taking; a rejection stops the reopen.
  agent.setter = 'keeps the old value'
  const unchanged = await agent.resumeSession({ sessionId: 'g', ...params({ model: 'b' }) })

  assert.equal(unchanged.configOptions[0].currentValue, 'a')
  agent.setter = 'rejects'
  await assert.rejects(agent.loadSession({ sessionId: 'f', ...params({ model: 'b' }) }), /rejected/)
  assert.throws(() => patchRuntimeDefaults('unexpected adapter'), /exactly one/)
})
