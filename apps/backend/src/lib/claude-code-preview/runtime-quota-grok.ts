import { z } from 'zod'

import { clampPercent, unavailable } from './runtime-quota-shape'

import type { RuntimeInstance } from './runtime-instances'
import type { RuntimeQuota } from './runtime-quota-shape'

// Grok answers its own ACP `_x.ai/billing` with the subscription's credit use
// for the current period.
const grokUsageSchema = z
  .object({
    config: z.object({
      creditUsagePercent: z.number(),
      currentPeriod: z
        .object({ type: z.string().optional(), end: z.string().optional() })
        .optional(),
    }),
  })
  .passthrough()

const GROK_PERIODS: Record<string, string> = {
  USAGE_PERIOD_TYPE_DAILY: 'Daily',
  USAGE_PERIOD_TYPE_WEEKLY: 'Weekly',
  USAGE_PERIOD_TYPE_MONTHLY: 'Monthly',
}

export function normalizeGrokUsage(
  instance: RuntimeInstance,
  body: unknown,
  fetchedAt: string,
): RuntimeQuota {
  const parsed = grokUsageSchema.safeParse(body)

  if (!parsed.success) return unavailable(instance, fetchedAt, 'Unrecognized usage response')
  const { creditUsagePercent, currentPeriod } = parsed.data.config

  return {
    runtimeId: instance.id,
    provider: instance.provider,
    fetchedAt,
    available: true,
    windows: [
      {
        id: 'period',
        label: GROK_PERIODS[currentPeriod?.type ?? ''] ?? 'Current period',
        usedPercent: clampPercent(creditUsagePercent),
        resetsAt: currentPeriod?.end ?? null,
      },
    ],
  }
}
