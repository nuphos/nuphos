import { z } from 'zod'

import { clampPercent, unavailable } from './runtime-quota-shape'

import type { RuntimeInstance } from './runtime-instances'
import type { RuntimeQuota, RuntimeQuotaResets, RuntimeQuotaWindow } from './runtime-quota-shape'

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

/** Anthropic's limit resets (`cedar_ember`), narrowed to what the team may see: how
 *  many each grant holds and until when, never its id. The block is private and
 *  unannounced, so one that does not fit is dropped and the usage beside it stays. */
export const claudeResetsSchema = z
  .object({
    grants: z
      .array(
        z
          .object({
            resets_left: z.number().int().min(0),
            ends_at: z.string().max(60).nullable().optional(),
            usable_now: z.boolean().optional(),
            paused: z.boolean().optional(),
          })
          .nullable()
          .catch(null),
      )
      .max(20),
  })
  .optional()
  .catch(undefined)

function claudeResets(body: unknown): RuntimeQuotaResets | undefined {
  const block = claudeResetsSchema.parse((body as { cedar_ember?: unknown }).cedar_ember)
  const grants = (block?.grants ?? []).flatMap((grant) =>
    grant && grant.resets_left > 0 && grant.paused !== true ? [grant] : [],
  )

  if (grants.length === 0) return
  const ends = grants
    .map((grant) => grant.ends_at ?? null)
    .filter((end): end is string => end !== null && !Number.isNaN(Date.parse(end)))
    .sort((a, b) => Date.parse(a) - Date.parse(b))

  return {
    left: grants.reduce((sum, grant) => sum + grant.resets_left, 0),
    expiresAt: ends[0] ?? null,
    usableNow: grants.some((grant) => grant.usable_now === true),
  }
}

type ClaudeWindowKey = 'five_hour' | 'seven_day' | 'seven_day_opus' | 'seven_day_sonnet'
const CLAUDE_WINDOWS: [ClaudeWindowKey, string][] = [
  ['five_hour', '5-hour'],
  ['seven_day', 'Weekly'],
  ['seven_day_opus', 'Weekly · Opus'],
  ['seven_day_sonnet', 'Weekly · Sonnet'],
]

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
  const resets = claudeResets(parsed.data)

  return {
    runtimeId: instance.id,
    provider: instance.provider,
    fetchedAt,
    available: windows.length > 0,
    ...(windows.length ? {} : { reason: 'No usage windows reported' }),
    windows,
    ...(resets ? { resets } : {}),
  }
}
