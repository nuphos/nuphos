import assert from 'node:assert/strict'
import { test } from 'node:test'

import { USAGE_SAMPLE_MS, USAGE_SIGN_IN_FLOOR_MS, freshAgent } from './controller-types.ts'
import { createUsageSampler } from './usage-sampler.ts'

import type { LocalAgentProvider } from './agent-cli.ts'
import type { Agent } from './controller-types.ts'

function sampler(read: () => Promise<unknown>, readTookMs = 0) {
  const agents: Record<LocalAgentProvider, Agent> = {
    'claude-code': freshAgent(),
    codex: freshAgent(),
  }

  for (const agent of Object.values(agents))
    agent.cli = { installed: true, path: '/bin/x', loggedIn: true }
  let clock = 1_000_000
  let readings = 0

  return {
    agents,
    readings: () => readings,
    advance: (ms: number) => {
      clock += ms
    },
    usage: createUsageSampler(
      agents,
      {
        userEnv: () => Promise.resolve({}),
        readUsage: () =>
          read().finally(() => {
            clock += readTookMs
          }),
      },
      () => {
        readings += 1
      },
      () => clock,
    ),
  }
}

test('a second read inside the interval is skipped, however often it is asked for', async () => {
  let reads = 0
  const h = sampler(() => {
    reads += 1

    return Promise.resolve({ seven_day: { utilization: 1 } })
  })

  // What a crash loop looks like: startProcess samples on every backoff tick.
  for (const delay of [0, 1_000, 2_000, 5_000, 15_000, 30_000]) {
    h.advance(delay)
    await h.usage.sample('claude-code')
  }

  assert.equal(reads, 1)
  h.advance(USAGE_SAMPLE_MS)
  await h.usage.sample('claude-code')
  assert.equal(reads, 2)
})

test('a sign-in earns a read without waiting out the interval', async () => {
  let reads = 0
  const h = sampler(() => {
    reads += 1

    return Promise.resolve({ seven_day: { utilization: 1 } })
  })

  await h.usage.sample('claude-code')
  assert.equal(reads, 1)
  // Check clicked straight away: still inside the short floor.
  await h.usage.sample('claude-code', true)
  assert.equal(reads, 1)
  h.advance(USAGE_SIGN_IN_FLOOR_MS)
  await h.usage.sample('claude-code', true)
  assert.equal(reads, 2)
})

test('two overlapping reads become one', async () => {
  let reads = 0
  // Assigned by the executor below, before anything can call it.
  let release!: (value: unknown) => void
  const answer = new Promise((resolve) => {
    release = resolve
  })
  const h = sampler(() => {
    reads += 1

    return answer
  })
  const both = Promise.all([h.usage.sample('claude-code'), h.usage.sample('claude-code')])

  release({ seven_day: { utilization: 1 } })
  await both
  assert.equal(reads, 1)
  assert.equal(h.readings(), 1)
})

test('an answer for an agent that has since restarted is dropped', async () => {
  // Assigned by the executor below, before anything can call it.
  let release!: (value: unknown) => void
  const answer = new Promise((resolve) => {
    release = resolve
  })
  const h = sampler(() => answer)
  const pending = h.usage.sample('claude-code')

  // What stopAgent does, while the read is still out.
  h.agents['claude-code'].generation += 1
  release({ seven_day: { utilization: 1 } })
  await pending

  assert.equal(h.agents['claude-code'].usage, undefined)
  assert.equal(h.agents['claude-code'].usageAt, undefined)
  assert.equal(h.readings(), 0)
})

test('a signed-out CLI is never asked', async () => {
  let reads = 0
  const h = sampler(() => {
    reads += 1

    return Promise.resolve({})
  })

  h.agents.codex.cli = { installed: true, path: '/bin/codex', loggedIn: false }
  await h.usage.sample('codex', true)
  assert.equal(reads, 0)
})

test('a read that takes time does not push the next one past the interval', async () => {
  let reads = 0
  const h = sampler(() => {
    reads += 1

    return Promise.resolve({ seven_day: { utilization: 1 } })
  }, 9_000)

  await h.usage.sample('claude-code')
  assert.equal(reads, 1)
  // The timer fires one interval after the read started, which is nine seconds
  // after it finished. Stamping the attempt on completion would skip this.
  h.advance(USAGE_SAMPLE_MS - 9_000)
  await h.usage.sample('claude-code')
  assert.equal(reads, 2)
})
