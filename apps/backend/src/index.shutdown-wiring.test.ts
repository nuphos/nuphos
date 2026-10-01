// index.ts boots the server (and the db, and OTel) at import time, so the
// SIGTERM sequence cannot be driven from a test process. What CAN be pinned is
// the part resolveShutdownBudget's own tests are blind to: which budget field
// feeds which stage of shutdown(). Swapping agentDrainForcePauseAtMs for
// agentDrainDeadlineMs there restores the bug this module was written to fix
// while every pure-function test stays green.
//
// So: read the wiring out of the source, then run the real drain engine with
// the value index.ts actually passes and assert the behaviour that value is
// supposed to produce.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

import {
  DEFAULT_AGENT_DRAIN_DEADLINE_MS,
  DEFAULT_LB_GRACE_MS,
  DEFAULT_TERMINATION_GRACE_SECONDS,
  GUARD_FLUSH_MS,
  HTTP_DRAIN_MS,
  drainRunsUntilForcePause,
  resolveShutdownBudget,
} from './lib/shutdown-budget'

import type { ShutdownBudget } from './lib/shutdown-budget'

const SHUTDOWN_BODY = (() => {
  const src = readFileSync(join(import.meta.dir, 'index.ts'), 'utf8')
  const start = src.indexOf('async function shutdown(')
  const end = src.indexOf('process.exit(0)', start)

  if (start < 0 || end < 0) {
    throw new Error('shutdown() not found in index.ts — this guard needs updating')
  }

  return src.slice(start, end).replace(/^[ \t]*\/\/.*$/gm, '')
})()

/** The `shutdownBudget.<field>` the named stage is wired to, or a clear failure. */
function budgetFieldFeeding(pattern: RegExp, stage: string): keyof ShutdownBudget {
  const matches = [...SHUTDOWN_BODY.matchAll(pattern)]

  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one ${stage} call in shutdown(), found ${String(matches.length)}. ` +
        `If the sequence was restructured, update this guard deliberately.`,
    )
  }
  const arg = matches[0]![1]!.trim()
  const field = arg.replace(/^shutdownBudget\./, '')

  if (field === arg || !field) {
    throw new Error(`${stage} is fed by \`${arg}\`, not by a config.shutdown field`)
  }

  return field as keyof ShutdownBudget
}

const drainField = budgetFieldFeeding(/drainInFlightAgentRuns\(([^()]*)\)/g, 'agent drain')

const defaults = {
  lbGraceMs: DEFAULT_LB_GRACE_MS,
  agentDrainDeadlineMs: DEFAULT_AGENT_DRAIN_DEADLINE_MS,
}

/**
 * Runs the real drain engine the way shutdown() does, on a fake clock.
 * `finishesAtMs` is when the single in-flight run would end on its own;
 * Infinity means it never does.
 */
async function drainAs(
  waitMs: number,
  finishesAtMs: number,
): Promise<{ pausedAtMs: number | null; elapsedMs: number }> {
  let now = 0
  let pausedAtMs: number | null = null

  await drainRunsUntilForcePause<string>({
    listInFlight: () => (now >= finishesAtMs ? [] : ['run-a']),
    forcePause: () => {},
    forcePauseAtMs: waitMs,
    pollIntervalMs: 250,
    now: () => now,
    sleep: async (ms) => {
      now += ms
    },
    onForcePause: (_count, waitedMs) => {
      pausedAtMs = waitedMs
    },
  })

  return { pausedAtMs, elapsedMs: now }
}

describe('shutdown() stage wiring in index.ts', () => {
  test('stops runtime reconciliation before the first drain wait', () => {
    const stop = SHUTDOWN_BODY.indexOf('shutdownClaudeCodeRuntimeProvisioner()')
    const firstAwait = SHUTDOWN_BODY.indexOf('await ')

    expect(stop).toBeGreaterThanOrEqual(0)
    expect(firstAwait).toBeGreaterThan(stop)
  })

  test('every stage is fed by its own budget field', () => {
    expect({
      lbGrace: budgetFieldFeeding(/setTimeout\(r,([^()]*)\)/g, 'LB grace sleep'),
      agentDrain: drainField,
      httpDrain: budgetFieldFeeding(/\},\s*(shutdownBudget\.[A-Za-z]+)\)/g, 'HTTP drain timer'),
      guardFlush: budgetFieldFeeding(/flushGuardWrites\(([^()]*)\)/g, 'guard flush'),
    }).toEqual({
      lbGrace: 'lbGraceMs',
      agentDrain: 'agentDrainForcePauseAtMs',
      httpDrain: 'httpDrainMs',
      guardFlush: 'guardFlushMs',
    })
  })

  test('the wired value force-pauses early enough to leave the whole delivery tail', async () => {
    const budget = resolveShutdownBudget({ terminationGraceMs: 180_000, ...defaults })
    const waitMs = budget[drainField] as number

    const { pausedAtMs } = await drainAs(waitMs, Number.POSITIVE_INFINITY)

    expect(pausedAtMs).not.toBeNull()
    // Passing agentDrainDeadlineMs here would spend the entire drain window
    // before emitting turn_paused, leaving nothing of it in hand.
    expect(budget.agentDrainDeadlineMs - (pausedAtMs as unknown as number)).toBeGreaterThanOrEqual(
      HTTP_DRAIN_MS + GUARD_FLUSH_MS,
    )
  })

  test('on an un-updated 30s grace period the wired value pauses without waiting', async () => {
    const budget = resolveShutdownBudget({
      terminationGraceMs: DEFAULT_TERMINATION_GRACE_SECONDS * 1_000,
      ...defaults,
    })
    const waitMs = budget[drainField] as number

    // A run that would have finished on its own a second in. With the drain
    // DEADLINE wired here (5s at this grace period) it would be allowed to; with
    // the force-pause point (0) it is paused immediately instead. That is the
    // trade this PR makes, and it is the wiring's most visible consequence.
    const { pausedAtMs, elapsedMs } = await drainAs(waitMs, 1_000)

    expect(pausedAtMs).toBe(0)
    expect(elapsedMs).toBe(0)
  })
})

test('worker consumers stop before draining but producer queues survive HTTP requests', () => {
  const consumers = SHUTDOWN_BODY.indexOf('quiesceAgentWorkers()')
  const drain = SHUTDOWN_BODY.indexOf('await drainHttpAndAgentProducers(')
  const queues = SHUTDOWN_BODY.indexOf('await closeAgentWorkerQueues()')
  const redis = SHUTDOWN_BODY.indexOf('closeRedis()')

  expect(consumers).toBeGreaterThan(0)
  expect(drain).toBeGreaterThan(consumers)
  expect(queues).toBeGreaterThan(drain)
  expect(redis).toBeGreaterThan(queues)
})
