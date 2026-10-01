import { z } from 'zod'

import { logError } from '@/lib/observability'

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

const CACHE_TTL_MS = 60_000
const UNAVAILABLE_CACHE_TTL_MS = 15_000

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

async function fetchUncached(
  teamId: string,
  instance: RuntimeInstance,
  deps: RuntimeQuotaDeps,
): Promise<RuntimeQuota> {
  const fetchedAt = new Date().toISOString()

  if (instance.kind === 'local')
    return unavailable(instance, fetchedAt, 'Usage is reported for team agents only')
  if (instance.status === 'disabled') return unavailable(instance, fetchedAt, 'Agent is disabled')
  let reading: RuntimeQuotaReading

  try {
    reading = await deps.probe(teamId, instance)
  } catch (error) {
    // A capability error is our own sentence about an agent that needs
    // updating, so it is worth showing. Other transport exceptions carry
    // internal hosts and ports and are only safe to log.
    if (error instanceof RuntimeCapabilityError)
      return unavailable(instance, fetchedAt, error.message)
    logError('agent.runtime_quota.probe_failed', error, {
      team_id: teamId,
      runtime_id: instance.id,
    })

    return unavailable(instance, fetchedAt, 'Usage lookup failed')
  }
  if ('error' in reading) return unavailable(instance, fetchedAt, reading.error)
  const quota =
    instance.provider === 'codex'
      ? normalizeCodexUsage(instance, reading.usage, fetchedAt)
      : normalizeClaudeUsage(instance, reading.usage, fetchedAt)

  return reading.plan && !quota.plan ? { ...quota, plan: reading.plan } : quota
}

const cache = new Map<string, { expires: number; result: Promise<RuntimeQuota> }>()

export function fetchRuntimeQuota(
  teamId: string,
  instance: RuntimeInstance,
  now: () => number = Date.now,
  deps: RuntimeQuotaDeps = defaultDeps,
): Promise<RuntimeQuota> {
  const key = `${teamId}:${instance.id}`
  const previous = cache.get(key)

  if (previous && previous.expires > now()) return previous.result
  for (const [id, entry] of cache) if (entry.expires <= now()) cache.delete(id)
  const entry = { expires: now() + CACHE_TTL_MS, result: fetchUncached(teamId, instance, deps) }

  entry.result = entry.result.then((quota) => {
    if (!quota.available && cache.get(key) === entry) {
      entry.expires = Math.min(entry.expires, now() + UNAVAILABLE_CACHE_TTL_MS)
    }

    return quota
  })
  cache.set(key, entry)

  return entry.result
}

export function clearRuntimeQuotaCache() {
  cache.clear()
}
