import { afterEach, expect, test } from 'bun:test'

import {
  clearRuntimeQuotaCache,
  fetchRuntimeQuota,
  normalizeClaudeUsage,
  normalizeCodexUsage,
} from './runtime-quota'
import {
  parseQuotaReading,
  RUNTIME_QUOTA_SENTINEL,
  RUNTIME_QUOTA_PROBE,
} from './runtime-quota-probe'
import { RuntimeCapabilityError } from './team-openab-runtime'

import type { RuntimeInstance } from './runtime-instances'
import type { RuntimeQuotaDeps } from './runtime-quota'
import type { RuntimeQuotaReading } from './runtime-quota-probe'

const fetchedAt = '2026-09-15T12:00:00.000Z'
const claude: RuntimeInstance = {
  id: 'claude-1',
  provider: 'claude-code',
  label: 'Claude',
  status: 'active',
  kind: 'managed',
  createdAt: fetchedAt,
}
const codex: RuntimeInstance = { ...claude, id: 'codex-1', provider: 'codex', label: 'Codex' }

afterEach(() => {
  clearRuntimeQuotaCache()
})

function probing(reading: RuntimeQuotaReading | (() => Promise<RuntimeQuotaReading>)): {
  deps: RuntimeQuotaDeps
  calls: () => number
} {
  let calls = 0

  return {
    deps: {
      probe: () => {
        calls++

        return typeof reading === 'function' ? reading() : Promise.resolve(reading)
      },
    },
    calls: () => calls,
  }
}

test('normalizes Claude usage windows', () => {
  const quota = normalizeClaudeUsage(
    claude,
    {
      five_hour: { utilization: 38.26, resets_at: '2026-09-15T14:30:00Z' },
      seven_day: { utilization: 12, resets_at: null },
      seven_day_opus: null,
      extra_usage: { enabled: false },
    },
    fetchedAt,
  )

  expect(quota.available).toBe(true)
  expect(quota.windows).toEqual([
    { id: 'five_hour', label: '5-hour', usedPercent: 38.3, resetsAt: '2026-09-15T14:30:00Z' },
    { id: 'seven_day', label: 'Weekly', usedPercent: 12, resetsAt: null },
  ])
})

test('normalizes Codex usage windows with relative resets', () => {
  const quota = normalizeCodexUsage(
    codex,
    {
      plan_type: 'plus',
      rate_limit: {
        allowed: true,
        primary_window: {
          used_percent: 61,
          limit_window_seconds: 18_000,
          reset_after_seconds: 600,
        },
        secondary_window: { used_percent: 130, limit_window_seconds: 604_800 },
      },
    },
    fetchedAt,
  )

  expect(quota.plan).toBe('plus')
  expect(quota.windows).toEqual([
    { id: 'primary', label: '5-hour', usedPercent: 61, resetsAt: '2026-09-15T12:10:00.000Z' },
    { id: 'secondary', label: 'Weekly', usedPercent: 100, resetsAt: null },
  ])
})

test('unrecognized bodies are unavailable rather than thrown', () => {
  expect(normalizeClaudeUsage(claude, 'nope', fetchedAt).available).toBe(false)
  expect(normalizeCodexUsage(codex, { rate_limit: null }, fetchedAt)).toMatchObject({
    available: false,
    reason: 'No usage windows reported',
  })
})

test('the probe prints on the sentinel the backend reads', () => {
  expect(RUNTIME_QUOTA_PROBE).toContain(`SENTINEL = '${RUNTIME_QUOTA_SENTINEL}'`)
})

test('reads the sentinel line the agent printed, ignoring anything around it', () => {
  const stdout = `warming up\n${RUNTIME_QUOTA_SENTINEL}${JSON.stringify({
    usage: { five_hour: { utilization: 5 } },
    plan: 'max',
  })}\n`

  expect(parseQuotaReading(stdout)).toEqual({
    usage: { five_hour: { utilization: 5 } },
    plan: 'max',
  })
  expect(parseQuotaReading('nothing here')).toEqual({ error: 'The agent reported no usage' })
  // The reason the agent gave must survive: it is what the badge's tooltip says.
  expect(parseQuotaReading(`${RUNTIME_QUOTA_SENTINEL}{"error":"Sign in required"}`)).toEqual({
    error: 'Sign in required',
  })
  expect(parseQuotaReading(`${RUNTIME_QUOTA_SENTINEL}{}`)).toEqual({
    error: 'The agent reported unreadable usage',
  })
  expect(parseQuotaReading(`${RUNTIME_QUOTA_SENTINEL}"nope"`)).toEqual({
    error: 'The agent reported unreadable usage',
  })
  expect(parseQuotaReading(`${RUNTIME_QUOTA_SENTINEL}{oops`)).toEqual({
    error: 'The agent reported unreadable usage',
  })
})

test("the agent's own reason is what the user sees", async () => {
  const { deps } = probing({ error: 'Sign in required' })

  expect(await fetchRuntimeQuota('t', claude, Date.now, deps)).toMatchObject({
    available: false,
    reason: 'Sign in required',
  })
})

test('local agents and disabled agents are never probed', async () => {
  const { deps, calls } = probing({ usage: {} })

  expect(
    (await fetchRuntimeQuota('t', { ...claude, kind: 'local' }, Date.now, deps)).reason,
  ).toMatch(/team agents only/u)
  expect(
    (await fetchRuntimeQuota('t', { ...codex, status: 'disabled' }, Date.now, deps)).reason,
  ).toBe('Agent is disabled')
  expect(calls()).toBe(0)
})

test('the plan the agent read locally survives normalization', async () => {
  const { deps } = probing({
    usage: { five_hour: { utilization: 5, resets_at: null } },
    plan: 'max',
  })
  const quota = await fetchRuntimeQuota('t', claude, Date.now, deps)

  expect(quota.available).toBe(true)
  expect(quota.plan).toBe('max')
})

test('a usable reading is cached, and an unavailable one only briefly', async () => {
  let clock = 1_000
  const now = () => clock
  const usable = probing({ usage: { five_hour: { utilization: 5, resets_at: null } } })
  const first = await fetchRuntimeQuota('t', claude, now, usable.deps)

  expect(await fetchRuntimeQuota('t', claude, now, usable.deps)).toBe(first)
  clock += 30_000
  await fetchRuntimeQuota('t', claude, now, usable.deps)
  expect(usable.calls()).toBe(1)

  const failing = probing({ error: 'Agent is offline' })

  expect((await fetchRuntimeQuota('t', codex, now, failing.deps)).reason).toBe('Agent is offline')
  await fetchRuntimeQuota('t', codex, now, failing.deps)
  expect(failing.calls()).toBe(1)
  clock += 16_000
  await fetchRuntimeQuota('t', codex, now, failing.deps)
  expect(failing.calls()).toBe(2)
})

test('an agent that needs updating says so, other exceptions do not', async () => {
  const { deps } = probing(() => Promise.reject(new RuntimeCapabilityError('Update this agent.')))

  expect((await fetchRuntimeQuota('t', claude, Date.now, deps)).reason).toBe('Update this agent.')
})

test('a transport exception is reported generically, never echoed', async () => {
  const { deps } = probing(() => Promise.reject(new Error('connect ECONNREFUSED 10.4.1.9:8080')))
  const quota = await fetchRuntimeQuota('t', claude, Date.now, deps)

  expect(quota.available).toBe(false)
  expect(quota.reason).toBe('Usage lookup failed')
})
