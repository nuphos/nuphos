import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

import { discoverModels } from './agent-models.ts'

import type { Agent, LocalAgentRun, LocalRuntimeControllerDeps } from './controller-types.ts'
import type { LocalModelCatalog } from './model-probe.ts'

const catalog: LocalModelCatalog = {
  models: [{ id: 'gpt-5', name: 'GPT-5' }],
  defaultModel: 'gpt-5',
  controls: {},
}

function setup(results: (LocalModelCatalog | Error)[]) {
  let probes = 0
  let sent = 0
  const deps = {
    probeModels: () => {
      const result = results[Math.min(probes++, results.length - 1)]

      return result instanceof Error ? Promise.reject(result) : Promise.resolve(result)
    },
  } as unknown as LocalRuntimeControllerDeps
  const current = { value: true }
  const run = { provider: 'codex', env: {}, current: () => current.value } as LocalAgentRun
  const agent = { runtime: { port: 1 } } as unknown as Agent

  discoverModels(deps, run, agent, '/w', () => sent++)

  return { agent, current, probes: () => probes, sent: () => sent }
}

const settle = () => new Promise((resolve) => setImmediate(resolve))

test('a failed model probe is tried again, so the agent does not stay without models', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const { agent, probes, sent } = setup([new Error('Model discovery timed out'), catalog])

    await settle()
    assert.equal(agent.models, undefined)
    mock.timers.tick(60_000)
    await settle()
    assert.equal(probes(), 2)
    assert.deepEqual(agent.models, catalog)
    assert.equal(sent(), 1)
  } finally {
    mock.timers.reset()
  }
})

test('retries stop once the agent it probed for is stopped or replaced', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const { agent, current, probes } = setup([new Error('signed out')])

    await settle()
    current.value = false
    mock.timers.tick(3_600_000)
    await settle()
    assert.equal(probes(), 1)

    const replaced = setup([new Error('signed out')])

    await settle()
    replaced.agent.runtime = { port: 2 } as Agent['runtime']
    mock.timers.tick(3_600_000)
    await settle()
    assert.equal(replaced.probes(), 1)
    assert.equal(agent.models, undefined)
  } finally {
    mock.timers.reset()
  }
})
