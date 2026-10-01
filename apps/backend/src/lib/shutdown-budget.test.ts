import { describe, expect, test } from 'bun:test'

import {
  DEFAULT_AGENT_DRAIN_DEADLINE_MS,
  DEFAULT_LB_GRACE_MS,
  DEFAULT_TERMINATION_GRACE_SECONDS,
  GUARD_FLUSH_MS,
  HTTP_DRAIN_MS,
  SAFETY_MARGIN_MS,
  drainRunsUntilForcePause,
  resolveShutdownBudget,
} from './shutdown-budget'

const defaults = {
  lbGraceMs: DEFAULT_LB_GRACE_MS,
  agentDrainDeadlineMs: DEFAULT_AGENT_DRAIN_DEADLINE_MS,
}

describe('resolveShutdownBudget', () => {
  test('the shipped defaults fit inside the 180s grace period production will set', () => {
    const budget = resolveShutdownBudget({ terminationGraceMs: 180_000, ...defaults })

    expect(budget.clamped).toBe(false)
    expect(budget.fitsWithinGrace).toBe(true)
    expect(budget.lbGraceMs).toBe(5_000)
    expect(budget.agentDrainDeadlineMs).toBe(150_000)
    // 5s + 150s + 15s + 2s
    expect(budget.totalMs).toBe(172_000)
    expect(budget.headroomMs).toBe(8_000)
  })

  test('the invariant holds: lbGrace + agentDrain + httpDrain + guardFlush <= grace', () => {
    for (let graceSeconds = 1; graceSeconds <= 600; graceSeconds++) {
      const budget = resolveShutdownBudget({
        terminationGraceMs: graceSeconds * 1_000,
        ...defaults,
      })
      const sum =
        budget.lbGraceMs + budget.agentDrainDeadlineMs + budget.httpDrainMs + budget.guardFlushMs

      expect(sum).toBe(budget.totalMs)
      if (budget.fitsWithinGrace) {
        expect(sum).toBeLessThanOrEqual(graceSeconds * 1_000)
      } else {
        expect(graceSeconds * 1_000).toBeLessThan(HTTP_DRAIN_MS + GUARD_FLUSH_MS)
      }
    }
  })

  test('an unset TERMINATION_GRACE_SECONDS clamps hard instead of overrunning', () => {
    const budget = resolveShutdownBudget({
      terminationGraceMs: DEFAULT_TERMINATION_GRACE_SECONDS * 1_000,
      lbGraceMs: DEFAULT_LB_GRACE_MS,
      agentDrainDeadlineMs: 300_000,
    })

    expect(budget.clamped).toBe(true)
    expect(budget.fitsWithinGrace).toBe(true)
    expect(budget.requestedAgentDrainDeadlineMs).toBe(300_000)
    // 30s - (15s http + 2s flush + 3s margin) - 5s lb grace
    expect(budget.agentDrainDeadlineMs).toBe(5_000)
    expect(budget.totalMs).toBe(27_000)
    expect(budget.totalMs).toBeLessThanOrEqual(budget.terminationGraceMs)
  })

  test('a drain window shorter than the delivery tail force-pauses immediately', () => {
    const budget = resolveShutdownBudget({
      terminationGraceMs: 30_000,
      lbGraceMs: DEFAULT_LB_GRACE_MS,
      agentDrainDeadlineMs: 300_000,
    })

    expect(budget.agentDrainForcePauseAtMs).toBe(0)
  })

  test('force-pause is held back from the deadline by the full delivery tail', () => {
    const budget = resolveShutdownBudget({ terminationGraceMs: 180_000, ...defaults })

    expect(budget.agentDrainForcePauseAtMs).toBe(
      budget.agentDrainDeadlineMs - (HTTP_DRAIN_MS + GUARD_FLUSH_MS),
    )
    expect(budget.agentDrainForcePauseAtMs).toBe(133_000)
    expect(
      budget.lbGraceMs + budget.agentDrainForcePauseAtMs + HTTP_DRAIN_MS + GUARD_FLUSH_MS,
    ).toBeLessThan(budget.terminationGraceMs)
  })

  test('a generous grace period does not inflate the drain beyond what was asked for', () => {
    const budget = resolveShutdownBudget({ terminationGraceMs: 900_000, ...defaults })

    expect(budget.agentDrainDeadlineMs).toBe(DEFAULT_AGENT_DRAIN_DEADLINE_MS)
    expect(budget.clamped).toBe(false)
  })

  test('the LB grace is sacrificed only after the drain has gone to zero', () => {
    const budget = resolveShutdownBudget({
      terminationGraceMs: 21_000,
      lbGraceMs: 5_000,
      agentDrainDeadlineMs: 150_000,
    })

    // 21s - 20s reserved leaves 1s.
    expect(budget.lbGraceMs).toBe(1_000)
    expect(budget.agentDrainDeadlineMs).toBe(0)
    expect(budget.agentDrainForcePauseAtMs).toBe(0)
    expect(budget.clamped).toBe(true)
    expect(budget.fitsWithinGrace).toBe(true)
  })

  test('a grace period below the fixed tail is reported as not fitting', () => {
    const budget = resolveShutdownBudget({
      terminationGraceMs: 10_000,
      lbGraceMs: 5_000,
      agentDrainDeadlineMs: 150_000,
    })

    expect(budget.lbGraceMs).toBe(0)
    expect(budget.agentDrainDeadlineMs).toBe(0)
    expect(budget.fitsWithinGrace).toBe(false)
    expect(budget.headroomMs).toBeLessThan(0)
  })

  test('the safety margin is real slack, not accounting', () => {
    const budget = resolveShutdownBudget({ terminationGraceMs: 180_000, ...defaults })

    expect(budget.totalMs + SAFETY_MARGIN_MS).toBeLessThanOrEqual(budget.terminationGraceMs)
  })

  test('negative or nonsensical inputs are floored rather than propagated', () => {
    const budget = resolveShutdownBudget({
      terminationGraceMs: -1,
      lbGraceMs: -5_000,
      agentDrainDeadlineMs: -1,
    })

    expect(budget.terminationGraceMs).toBe(0)
    expect(budget.lbGraceMs).toBe(0)
    expect(budget.agentDrainDeadlineMs).toBe(0)
    expect(budget.agentDrainForcePauseAtMs).toBe(0)
  })
})

function fakeClock() {
  let now = 0

  return {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms
    },
    advance: (ms: number) => {
      now += ms
    },
    get value() {
      return now
    },
  }
}

describe('drainRunsUntilForcePause', () => {
  test('returns immediately when nothing is in flight', async () => {
    const clock = fakeClock()
    const paused: string[] = []
    let waitStarted = false

    await drainRunsUntilForcePause<string>({
      listInFlight: () => [],
      forcePause: (r) => paused.push(r),
      forcePauseAtMs: 133_000,
      now: clock.now,
      sleep: clock.sleep,
      onWaitStart: () => {
        waitStarted = true
      },
    })

    expect(paused).toEqual([])
    expect(waitStarted).toBe(false)
    expect(clock.value).toBe(0)
  })

  test('stops waiting as soon as the last run finishes on its own', async () => {
    const clock = fakeClock()
    const paused: string[] = []
    let polls = 0

    await drainRunsUntilForcePause<string>({
      listInFlight: () => {
        polls++

        return polls > 4 ? [] : ['run-a']
      },
      forcePause: (r) => paused.push(r),
      forcePauseAtMs: 133_000,
      pollIntervalMs: 250,
      now: clock.now,
      sleep: clock.sleep,
    })

    expect(paused).toEqual([])
    expect(clock.value).toBe(1_000)
  })

  test('force-pauses at the force-pause point, not at the full drain deadline', async () => {
    const budget = resolveShutdownBudget({ terminationGraceMs: 180_000, ...defaults })
    const clock = fakeClock()
    const paused: string[] = []
    let pausedAtMs = -1

    await drainRunsUntilForcePause<string>({
      listInFlight: () => ['run-a', 'run-b'],
      forcePause: (r) => paused.push(r),
      forcePauseAtMs: budget.agentDrainForcePauseAtMs,
      pollIntervalMs: 250,
      now: clock.now,
      sleep: clock.sleep,
      onForcePause: (_count, waitedMs) => {
        pausedAtMs = waitedMs
      },
    })

    expect(paused).toEqual(['run-a', 'run-b'])
    expect(pausedAtMs).toBe(133_000)
    expect(pausedAtMs).toBeLessThan(budget.agentDrainDeadlineMs)
    expect(budget.agentDrainDeadlineMs - pausedAtMs).toBe(HTTP_DRAIN_MS + GUARD_FLUSH_MS)
  })

  test('pauses without waiting when the force-pause point is zero', async () => {
    const clock = fakeClock()
    const paused: string[] = []

    await drainRunsUntilForcePause<string>({
      listInFlight: () => ['run-a'],
      forcePause: (r) => paused.push(r),
      forcePauseAtMs: 0,
      now: clock.now,
      sleep: clock.sleep,
    })

    expect(paused).toEqual(['run-a'])
    expect(clock.value).toBe(0)
  })

  test('reports the in-flight count when it starts waiting and when it gives up', async () => {
    const clock = fakeClock()
    const observed: [string, number][] = []

    await drainRunsUntilForcePause<string>({
      listInFlight: () => ['run-a', 'run-b', 'run-c'],
      forcePause: () => {},
      forcePauseAtMs: 500,
      pollIntervalMs: 250,
      now: clock.now,
      sleep: clock.sleep,
      onWaitStart: (n) => observed.push(['wait', n]),
      onForcePause: (n) => observed.push(['pause', n]),
    })

    expect(observed).toEqual([
      ['wait', 3],
      ['pause', 3],
    ])
  })

  test('a run that throws while pausing does not strand the others', async () => {
    const clock = fakeClock()
    const paused: string[] = []

    await drainRunsUntilForcePause<string>({
      listInFlight: () => ['bad', 'good'],
      // Mirrors routes/agent.ts, which swallows per-run failures internally.
      forcePause: (r) => {
        try {
          if (r === 'bad') throw new Error('boom')
        } catch {
          // swallowed, as the real adapter does
        }
        paused.push(r)
      },
      forcePauseAtMs: 0,
      now: clock.now,
      sleep: clock.sleep,
    })

    expect(paused).toEqual(['bad', 'good'])
  })
})
