import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

import {
  discoverModels,
  MODEL_FIRST_READ_MS,
  MODEL_ON_DEMAND_MS,
  MODEL_REFRESH_MS,
  MODEL_RETRY_MS,
  MODEL_SIGNED_OUT_MS,
  refreshRunningModels,
} from './agent-models.ts'

import type { Agent, LocalAgentRun, LocalRuntimeControllerDeps } from './controller-types.ts'
import type { LocalModelCatalog } from './model-probe.ts'

const catalog: LocalModelCatalog = {
  models: [{ id: 'gpt-5', name: 'GPT-5' }],
  defaultModel: 'gpt-5',
  controls: {},
}

function setup(results: (LocalModelCatalog | Error)[], provider = 'codex') {
  let probes = 0
  let sent = 0
  const deps = {
    probeModels: () => {
      const result = results[Math.min(probes++, results.length - 1)]

      return result instanceof Error ? Promise.reject(result) : Promise.resolve(result)
    },
  } as unknown as LocalRuntimeControllerDeps
  const current = { value: true }
  const run = { provider, env: {}, current: () => current.value } as LocalAgentRun
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

test('a signed-out CLI is not started to list models until it signs in', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    let probes = 0
    const deps = {
      probeModels: () => {
        probes++

        return Promise.resolve(catalog)
      },
    } as unknown as LocalRuntimeControllerDeps
    const run = { provider: 'codex', env: {}, current: () => true } as LocalAgentRun
    const agent = {
      runtime: { port: 1 },
      cli: { installed: true, path: '/bin/codex', loggedIn: false },
    } as unknown as Agent

    let sent = 0

    discoverModels(deps, run, agent, '/w', () => sent++)
    await settle()
    assert.equal(await refreshRunningModels(), false)
    mock.timers.tick(3_600_000)
    await settle()
    assert.equal(probes, 0)

    agent.cli = { installed: true, path: '/bin/codex', loggedIn: true }
    mock.timers.tick(MODEL_SIGNED_OUT_MS)
    await settle()
    assert.equal(probes, 1)
    assert.deepEqual(agent.models, catalog)
    assert.equal(sent, 1)
  } finally {
    mock.timers.reset()
  }
})

const catalogOf = (...ids: string[]): LocalModelCatalog => ({
  models: ids.map((id) => ({ id, name: id })),
  defaultModel: ids[0] ?? '',
  controls: {},
})

function running(answers: (LocalModelCatalog | Error)[]) {
  let current = true
  const probes: number[] = []
  const deps = {
    probeModels: () => {
      probes.push(probes.length)
      const answer = answers.shift() ?? new Error('no more answers')

      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)
    },
  } as unknown as LocalRuntimeControllerDeps
  const run = { provider: 'codex', env: {}, current: () => current } as unknown as LocalAgentRun
  const agent = { runtime: {} } as Agent
  const sent: unknown[] = []

  return {
    probes,
    sent,
    ids: () => agent.models?.models.map((model) => model.id),
    start: () => discoverModels(deps, run, agent, '/w', () => sent.push(agent.models)),
    /** The agent's process restarted: the controller starts a new read for it. */
    restart: () => {
      agent.runtime = {} as Agent['runtime']
      discoverModels(deps, run, agent, '/w', () => sent.push(agent.models))
    },
    replaceRun: () => {
      current = false
    },
  }
}

test('a failed read is retried, and the list is read again while the agent runs', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const { probes, ids, sent, start } = running([
      new Error('Model discovery timed out'),
      catalogOf('terra', 'luna'),
      catalogOf('terra', 'luna'),
      catalogOf('astra', 'sol', 'terra', 'luna'),
    ])

    start()
    await settle()
    assert.equal(ids(), undefined)
    mock.timers.tick(MODEL_RETRY_MS[0] ?? 0)
    await settle()
    assert.deepEqual(ids(), ['terra', 'luna'])
    // The same list again sends nothing new.
    mock.timers.tick(MODEL_REFRESH_MS)
    await settle()
    assert.equal(sent.length, 1)
    mock.timers.tick(MODEL_REFRESH_MS)
    await settle()
    assert.deepEqual(ids(), ['astra', 'sol', 'terra', 'luna'])
    assert.equal(sent.length, 2)
    assert.equal(probes.length, 4)
  } finally {
    mock.timers.reset()
  }
})

test('a replaced run stops reading, and a restart keeps a single loop', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const first = running([catalogOf('a'), catalogOf('a'), catalogOf('a'), catalogOf('a')])

    first.start()
    await settle()
    // The process restarted on the same run: one loop remains.
    first.restart()
    await settle()
    mock.timers.tick(MODEL_REFRESH_MS)
    await settle()
    assert.equal(first.probes.length, 3)
    first.replaceRun()
    mock.timers.tick(MODEL_REFRESH_MS)
    await settle()
    assert.equal(first.probes.length, 3)
  } finally {
    mock.timers.reset()
  }
})

test('an opened picker reads running agents again, at most once a minute', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  try {
    const agent = running([
      catalogOf('terra'),
      catalogOf('astra', 'terra'),
      catalogOf('astra', 'terra'),
    ])

    agent.start()
    await settle()
    // Just read at start: nothing new is asked yet.
    assert.equal(await refreshRunningModels(), false)
    assert.equal(agent.probes.length, 1)
    mock.timers.tick(MODEL_ON_DEMAND_MS)
    assert.equal(await refreshRunningModels(), true)
    assert.deepEqual(agent.ids(), ['astra', 'terra'])
    mock.timers.tick(MODEL_ON_DEMAND_MS)
    assert.equal(await refreshRunningModels(), false)
    assert.equal(agent.probes.length, 3)
    // A replaced run is asked nothing.
    agent.replaceRun()
    mock.timers.tick(MODEL_ON_DEMAND_MS)
    assert.equal(await refreshRunningModels(), false)
    assert.equal(agent.probes.length, 3)
  } finally {
    mock.timers.reset()
  }
})

test('an adapter that keeps failing is not started again on demand sooner than a retry', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  try {
    // Every read fails, as an adapter that exits at once does.
    const agent = running([])

    agent.start()
    await settle()
    mock.timers.tick(MODEL_RETRY_MS[0] ?? 0)
    await settle()
    assert.equal(agent.probes.length, 2)
    // Two failures: the next retry is 2 minutes out, and an opened picker waits for it too.
    await refreshRunningModels()
    mock.timers.tick(MODEL_ON_DEMAND_MS)
    await refreshRunningModels()
    assert.equal(agent.probes.length, 2)
    mock.timers.tick(MODEL_ON_DEMAND_MS)
    await settle()
    assert.equal(agent.probes.length, 3)
    agent.replaceRun()
  } finally {
    mock.timers.reset()
  }
})

test("Hermes's first read waits, so its daemon does not start beside the first conversation's", async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const { agent, probes } = setup([catalog], 'hermes')

    await settle()
    assert.equal(probes(), 0)
    mock.timers.tick(MODEL_FIRST_READ_MS.hermes! - 1)
    await settle()
    assert.equal(probes(), 0)
    mock.timers.tick(1)
    await settle()
    assert.equal(probes(), 1)
    assert.deepEqual(agent.models, catalog)
  } finally {
    mock.timers.reset()
  }
})

test('an opened picker reads a waiting Hermes at once', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const { agent, probes } = setup([catalog], 'hermes')

    await settle()
    assert.equal(await refreshRunningModels(), true)
    assert.equal(probes(), 1)
    assert.deepEqual(agent.models, catalog)
  } finally {
    mock.timers.reset()
  }
})
