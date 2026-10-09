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
/** One instant, so a cached answer would be reused if there were one. */
const frozen = () => 1_000
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

test('the probe claims the provider answered only once it has a response', () => {
  const fetchAt = RUNTIME_QUOTA_PROBE.indexOf('await fetch(')
  const billingAt = RUNTIME_QUOTA_PROBE.indexOf("'_x.ai/billing'")

  expect(fetchAt).toBeGreaterThan(0)
  expect(billingAt).toBeGreaterThan(0)
  // A fetch that throws is a network failure, not a refusal. Setting the flag
  // before the response exists would earn that failure the ten-minute hold.
  expect(RUNTIME_QUOTA_PROBE.indexOf('asked = true;', fetchAt)).toBeGreaterThan(fetchAt)
  expect(RUNTIME_QUOTA_PROBE.indexOf('asked = true;', billingAt)).toBeGreaterThan(billingAt)
  expect(RUNTIME_QUOTA_PROBE.indexOf('asked = true;')).toBeGreaterThan(billingAt)
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

test('an agent without a usage API is never probed', async () => {
  const { deps, calls } = probing({ error: 'Sign in required' })
  const antigravity: RuntimeInstance = {
    ...claude,
    id: 'agy-1',
    provider: 'antigravity',
    label: 'Antigravity',
  }

  expect(await fetchRuntimeQuota('t', antigravity, Date.now, deps)).toMatchObject({
    available: false,
    reason: 'Antigravity does not report usage',
  })
  expect(calls()).toBe(0)
})

test("normalizes Grok's billing period", async () => {
  const grok: RuntimeInstance = { ...claude, id: 'grok-1', provider: 'grok', label: 'Grok' }
  const { deps } = probing({
    usage: {
      config: {
        creditUsagePercent: 12.34,
        currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', end: '2026-10-06T06:37:43Z' },
      },
      subscription_tier: 'SuperGrok',
    },
    plan: 'SuperGrok',
  })

  expect(await fetchRuntimeQuota('t', grok, frozen, deps)).toMatchObject({
    available: true,
    plan: 'SuperGrok',
    windows: [
      { id: 'period', label: 'Weekly', usedPercent: 12.3, resetsAt: '2026-10-06T06:37:43Z' },
    ],
  })
})

const onOwnComputer = (
  usage?: unknown,
  signedIn: boolean | null = true,
  usageAt?: string,
): RuntimeInstance => ({
  ...claude,
  id: 'local-1',
  kind: 'local',
  local: {
    ownerUserId: 'u1',
    deviceId: 'd1',
    deviceLabel: 'My Mac',
    signedIn,
    ...(usage !== undefined ? { usage } : {}),
    ...(usageAt ? { usageAt } : {}),
  },
})

test('an agent on your own computer reports what it already read, unprobed', async () => {
  const { deps, calls } = probing({ usage: {} })
  const quota = await fetchRuntimeQuota(
    't',
    onOwnComputer({ seven_day: { utilization: 42, resets_at: '2026-09-18T09:00:00Z' } }),
    Date.now,
    deps,
  )

  expect(quota.windows).toEqual([
    { id: 'seven_day', label: 'Weekly', usedPercent: 42, resetsAt: '2026-09-18T09:00:00Z' },
  ])
  expect(calls()).toBe(0)
})

test('a Codex window is anchored to when that computer asked, not to this request', async () => {
  const { deps } = probing({ usage: {} })
  const readAt = '2026-09-15T12:00:00.000Z'
  const quota = await fetchRuntimeQuota(
    't',
    {
      ...onOwnComputer(
        { rate_limit: { primary_window: { used_percent: 20, reset_after_seconds: 600 } } },
        true,
        readAt,
      ),
      provider: 'codex',
    },
    Date.now,
    { probe: deps.probe },
  )

  // Ten minutes after the computer asked — not ten minutes from now, which is
  // what a snapshot re-stamped on every poll would keep promising.
  expect(quota.windows[0]?.resetsAt).toBe('2026-09-15T12:10:00.000Z')
  expect(quota.fetchedAt).toBe(readAt)
})

test('a computer that reported no usage says why, and disabled agents are never probed', async () => {
  const { deps, calls } = probing({ usage: {} })

  expect(
    (await fetchRuntimeQuota('t', onOwnComputer(undefined, false), Date.now, deps)).reason,
  ).toBe('Sign in to Claude Code on that computer')
  expect((await fetchRuntimeQuota('t', onOwnComputer(), Date.now, deps)).reason).toBe(
    'That computer has not reported usage yet',
  )
  expect(
    (await fetchRuntimeQuota('t', { ...codex, status: 'disabled' }, Date.now, deps)).reason,
  ).toBe('Agent is disabled')
  expect(calls()).toBe(0)
})

test('an agent re-enabled inside a hold is not still reported as disabled', async () => {
  const { deps, calls } = probing({ usage: { five_hour: { utilization: 5, resets_at: null } } })

  expect(
    (await fetchRuntimeQuota('t', { ...claude, status: 'disabled' }, frozen, deps)).reason,
  ).toBe('Agent is disabled')
  // Same instant, so a cached answer would still say disabled.
  expect((await fetchRuntimeQuota('t', claude, frozen, deps)).available).toBe(true)
  expect(calls()).toBe(1)
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

test('what the provider answered is held for ten minutes', async () => {
  let clock = 1_000
  const now = () => clock
  const usable = probing({ usage: { five_hour: { utilization: 5, resets_at: null } } })
  const first = await fetchRuntimeQuota('t', claude, now, usable.deps)

  expect(await fetchRuntimeQuota('t', claude, now, usable.deps)).toBe(first)
  clock += 599_000
  await fetchRuntimeQuota('t', claude, now, usable.deps)
  expect(usable.calls()).toBe(1)

  // A refusal is the provider's own answer, and asking again sooner is exactly
  // what kept the account rate-limited.
  const limited = probing({ error: 'HTTP 429', asked: true })

  expect((await fetchRuntimeQuota('t', codex, now, limited.deps)).reason).toBe('HTTP 429')
  clock += 599_000
  await fetchRuntimeQuota('t', codex, now, limited.deps)
  expect(limited.calls()).toBe(1)
  clock += 2_000
  await fetchRuntimeQuota('t', codex, now, limited.deps)
  expect(limited.calls()).toBe(2)
})

test('a failure the provider never saw is retried in seconds', async () => {
  let clock = 1_000
  const now = () => clock
  const offline = probing({ error: 'Agent is offline' })

  expect((await fetchRuntimeQuota('t', claude, now, offline.deps)).reason).toBe('Agent is offline')
  clock += 29_000
  await fetchRuntimeQuota('t', claude, now, offline.deps)
  expect(offline.calls()).toBe(1)
  clock += 2_000
  await fetchRuntimeQuota('t', claude, now, offline.deps)
  expect(offline.calls()).toBe(2)
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

test('a completed sign-in is not answered with the "Sign in required" held before it', async () => {
  let reading: RuntimeQuotaReading = { error: 'Sign in required', asked: true }
  const { deps, calls } = probing(() => Promise.resolve(reading))

  expect((await fetchRuntimeQuota('t', claude, frozen, deps, 'attempt-1')).reason).toBe(
    'Sign in required',
  )
  reading = { usage: { five_hour: { utilization: 10, resets_at: null } } }
  expect((await fetchRuntimeQuota('t', claude, frozen, deps, 'attempt-1')).available).toBe(false)
  expect((await fetchRuntimeQuota('t', claude, frozen, deps, 'attempt-2')).available).toBe(true)
  expect(calls()).toBe(2)
})

test('each answer the provider gives is recorded once, not once per poll', async () => {
  const { deps } = probing({ usage: { five_hour: { utilization: 5, resets_at: null } } })
  const recorded: string[] = []
  const record = (quota: { runtimeId: string }) => {
    recorded.push(quota.runtimeId)

    return Promise.resolve()
  }

  await fetchRuntimeQuota('t', claude, frozen, { ...deps, record })
  await fetchRuntimeQuota('t', claude, frozen, { ...deps, record })
  expect(recorded).toEqual(['claude-1'])
})
