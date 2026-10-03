import { expect, test } from 'bun:test'

import { localRuntimeStatusSchema } from './protocol'

const usage = {
  five_hour: { utilization: 38.2, resets_at: '2026-09-15T14:30:00Z' },
  seven_day: { utilization: 12, resets_at: null },
}

test('a computer reports usage the quota normalizer can read', () => {
  const parsed = localRuntimeStatusSchema.parse({
    agents: { 'claude-code': { cli: { installed: true, loggedIn: true }, usage } },
  })

  expect(parsed.agents['claude-code']?.usage).toEqual(usage)
})

test('anything else in the usage field is stripped before the team can see it', () => {
  const parsed = localRuntimeStatusSchema.parse({
    agents: {
      'claude-code': {
        cli: { installed: true, loggedIn: true },
        usage: {
          seven_day: { utilization: 1, resets_at: null, note: 'x'.repeat(5_000) },
          smuggled: 'y'.repeat(2_000_000),
          nested: { deep: { deeper: [1, 2, 3] } },
        },
      },
    },
  })

  expect(parsed.agents['claude-code']?.usage).toEqual({
    seven_day: { utilization: 1, resets_at: null },
  })
})

test('a window the provider adds later does not cost the whole status frame', () => {
  const parsed = localRuntimeStatusSchema.parse({
    agents: {
      codex: {
        cli: { installed: true, loggedIn: true },
        usage: { plan_type: 'plus', thirty_day: { used_percent: 4 } },
      },
    },
  })

  expect(parsed.agents.codex?.usage).toEqual({ plan_type: 'plus' })
})

test('a reading that does not fit costs the reading, never the heartbeat', () => {
  const parsed = localRuntimeStatusSchema.parse({
    localExec: true,
    agents: {
      'claude-code': {
        cli: { installed: true, loggedIn: true },
        usage: { five_hour: { utilization: '38%' }, seven_day: { utilization: 12 } },
      },
      codex: { cli: { installed: true, loggedIn: null }, usage: 'not an object at all' },
    },
  })

  // The malformed window is dropped, the sound one beside it survives, and both
  // agents are still in the heartbeat.
  expect(parsed.agents['claude-code']?.usage).toEqual({
    five_hour: null,
    seven_day: { utilization: 12 },
  })
  expect(parsed.agents.codex?.usage).toBeUndefined()
  expect(parsed.agents.codex?.cli.installed).toBe(true)
  expect(parsed.localExec).toBe(true)
})
