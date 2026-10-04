import { z } from 'zod'

import { logError } from '@/lib/observability'

import { runtimeLabel } from './runtime-provider'
import { probeRuntimeQuota } from './runtime-quota-probe'
import { RuntimeCapabilityError } from './team-openab-runtime'

import type { RuntimeInstance } from './runtime-instances'
import type { OpenAbProvider } from './runtime-provider'
import type { RuntimeQuotaReading } from './runtime-quota-probe'

export type RuntimeQuotaWindow = {
  id: string
  label: string
  usedPercent: number
  resetsAt: string | null
}

export type RuntimeQuota = {
  runtimeId: string
  provider: OpenAbProvider
  fetchedAt: string
  available: boolean
  reason?: string
  plan?: string
  windows: RuntimeQuotaWindow[]
}

// Usage windows are five hours and a week wide, and the providers rate-limit
// the endpoints that report them: Anthropic's answers 429 to a minute-paced
// caller and keeps answering 429 while it is asked again. So anything the
// provider itself answered — a usable reading or its own refusal — is held for
// ten minutes, which is as fresh as these numbers ever need to be.
const PROVIDER_HOLD_MS = 600_000
// Everything else never reached the provider: an offline agent, an image
// without the job, a lost connection. Asking again costs one local job, so an
// agent that comes back shows its usage in seconds rather than minutes.
const RETRY_HOLD_MS = 30_000

const claudeWindow = z
  .object({
    utilization: z.number().optional(),
    resets_at: z.string().nullable().optional(),
  })
  .nullable()
  .optional()

const claudeUsageSchema = z
  .object({
    five_hour: claudeWindow,
    seven_day: claudeWindow,
    seven_day_opus: claudeWindow,
    seven_day_sonnet: claudeWindow,
  })
  .passthrough()

const codexWindow = z
  .object({
    used_percent: z.number().optional(),
    limit_window_seconds: z.number().optional(),
    reset_after_seconds: z.number().optional(),
  })
  .nullable()
  .optional()

const codexUsageSchema = z
  .object({
    plan_type: z.string().optional(),
    rate_limit: z
      .object({ primary_window: codexWindow, secondary_window: codexWindow })
      .nullable()
      .optional(),
  })
  .passthrough()

type ClaudeWindowKey = 'five_hour' | 'seven_day' | 'seven_day_opus' | 'seven_day_sonnet'
const CLAUDE_WINDOWS: [ClaudeWindowKey, string][] = [
  ['five_hour', '5-hour'],
  ['seven_day', 'Weekly'],
  ['seven_day_opus', 'Weekly · Opus'],
  ['seven_day_sonnet', 'Weekly · Sonnet'],
]

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value * 10) / 10))
}

function unavailable(instance: RuntimeInstance, fetchedAt: string, reason: string): RuntimeQuota {
  return {
    runtimeId: instance.id,
    provider: instance.provider,
    fetchedAt,
    available: false,
    reason,
    windows: [],
  }
}

export function normalizeClaudeUsage(
  instance: RuntimeInstance,
  body: unknown,
  fetchedAt: string,
): RuntimeQuota {
  const parsed = claudeUsageSchema.safeParse(body)

  if (!parsed.success) return unavailable(instance, fetchedAt, 'Unrecognized usage response')
  const windows: RuntimeQuotaWindow[] = []

  for (const [key, label] of CLAUDE_WINDOWS) {
    const window = parsed.data[key]

    if (!window || typeof window.utilization !== 'number') continue
    windows.push({
      id: key,
      label,
      usedPercent: clampPercent(window.utilization),
      resetsAt: window.resets_at ?? null,
    })
  }

  return {
    runtimeId: instance.id,
    provider: instance.provider,
    fetchedAt,
    available: windows.length > 0,
    ...(windows.length ? {} : { reason: 'No usage windows reported' }),
    windows,
  }
}

function codexWindowLabel(seconds: number | undefined, fallback: string): string {
  if (!seconds) return fallback
  const hours = seconds / 3600

  if (hours >= 24 * 6) return 'Weekly'
  if (hours >= 24) return `${String(Math.round(hours / 24))}-day`

  return `${String(Math.round(hours))}-hour`
}

export function normalizeCodexUsage(
  instance: RuntimeInstance,
  body: unknown,
  fetchedAt: string,
): RuntimeQuota {
  const parsed = codexUsageSchema.safeParse(body)

  if (!parsed.success) return unavailable(instance, fetchedAt, 'Unrecognized usage response')
  const fetchedMs = Date.parse(fetchedAt)
  const windows: RuntimeQuotaWindow[] = []
  const entries = [
    ['primary', parsed.data.rate_limit?.primary_window, 'Primary'],
    ['secondary', parsed.data.rate_limit?.secondary_window, 'Secondary'],
  ] as const

  for (const [id, window, fallback] of entries) {
    if (!window || typeof window.used_percent !== 'number') continue
    windows.push({
      id,
      label: codexWindowLabel(window.limit_window_seconds, fallback),
      usedPercent: clampPercent(window.used_percent),
      resetsAt:
        typeof window.reset_after_seconds === 'number'
          ? new Date(fetchedMs + window.reset_after_seconds * 1000).toISOString()
          : null,
    })
  }

  return {
    runtimeId: instance.id,
    provider: instance.provider,
    fetchedAt,
    available: windows.length > 0,
    ...(windows.length ? {} : { reason: 'No usage windows reported' }),
    ...(parsed.data.plan_type ? { plan: parsed.data.plan_type } : {}),
    windows,
  }
}

export type RuntimeQuotaDeps = { probe: typeof probeRuntimeQuota }
const defaultDeps: RuntimeQuotaDeps = { probe: probeRuntimeQuota }

type Held = { quota: RuntimeQuota; holdMs: number }

async function fetchUncached(
  teamId: string,
  instance: RuntimeInstance,
  deps: RuntimeQuotaDeps,
): Promise<Held> {
  const fetchedAt = new Date().toISOString()
  const retry = (reason: string): Held => ({
    quota: unavailable(instance, fetchedAt, reason),
    holdMs: RETRY_HOLD_MS,
  })
  let reading: RuntimeQuotaReading

  try {
    reading = await deps.probe(teamId, instance)
  } catch (error) {
    // A capability error is our own sentence about an agent that needs
    // updating, so it is worth showing. Other transport exceptions carry
    // internal hosts and ports and are only safe to log.
    if (error instanceof RuntimeCapabilityError) return retry(error.message)
    logError('agent.runtime_quota.probe_failed', error, {
      team_id: teamId,
      runtime_id: instance.id,
    })

    return retry('Usage lookup failed')
  }
  if ('error' in reading)
    return reading.asked === true
      ? { quota: unavailable(instance, fetchedAt, reading.error), holdMs: PROVIDER_HOLD_MS }
      : retry(reading.error)
  const quota =
    instance.provider === 'codex'
      ? normalizeCodexUsage(instance, reading.usage, fetchedAt)
      : normalizeClaudeUsage(instance, reading.usage, fetchedAt)

  return {
    quota: reading.plan && !quota.plan ? { ...quota, plan: reading.plan } : quota,
    holdMs: PROVIDER_HOLD_MS,
  }
}

/** An agent on the owner's own computer reads its own account and reports the
 *  answer with its presence, so there is nothing for Nuphos to ask: normalize
 *  what arrived, the same way a probe's reading is normalized. */
function localQuota(instance: RuntimeInstance): RuntimeQuota {
  const usage = instance.local?.usage

  if (usage === undefined)
    return unavailable(
      instance,
      new Date().toISOString(),
      instance.local?.signedIn === false
        ? `Sign in to ${runtimeLabel(instance.provider)} on that computer`
        : 'That computer has not reported usage yet',
    )

  // The instant that computer asked the provider, not the instant this route
  // ran: Codex reports its windows as offsets from the question, so every later
  // poll over the same body would push "resets in …" further out.
  const readAt = instance.local?.usageAt ?? new Date().toISOString()

  return instance.provider === 'codex'
    ? normalizeCodexUsage(instance, usage, readAt)
    : normalizeClaudeUsage(instance, usage, readAt)
}

const cache = new Map<string, { expires: number; result: Promise<RuntimeQuota> }>()

export function fetchRuntimeQuota(
  teamId: string,
  instance: RuntimeInstance,
  now: () => number = Date.now,
  deps: RuntimeQuotaDeps = defaultDeps,
): Promise<RuntimeQuota> {
  // Answered from the instance alone, so there is nothing to ask and nothing to
  // hold: an agent re-enabled a moment ago must not read as disabled for the
  // length of a cache entry.
  if (instance.kind === 'local') return Promise.resolve(localQuota(instance))
  if (instance.status === 'disabled')
    return Promise.resolve(unavailable(instance, new Date().toISOString(), 'Agent is disabled'))
  const key = `${teamId}:${instance.id}`
  const previous = cache.get(key)

  if (previous && previous.expires > now()) return previous.result
  for (const [id, entry] of cache) if (entry.expires <= now()) cache.delete(id)
  const held = fetchUncached(teamId, instance, deps)
  // The hold the reading earns is known only once it arrives, so the entry
  // starts with the shorter one and the reading extends it.
  const entry = { expires: now() + RETRY_HOLD_MS, result: held.then((h) => h.quota) }

  cache.set(key, entry)
  void held.then((h) => {
    if (cache.get(key) === entry) entry.expires = now() + h.holdMs
  })

  return entry.result
}

export function clearRuntimeQuotaCache() {
  cache.clear()
}
