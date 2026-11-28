// The provider's usage body as a computer relays it, narrowed to what runtime-quota reads.
import { z } from 'zod'

import { codexCreditsSchema } from '@/lib/claude-code-preview/runtime-quota-shape'

/** One usage window as Anthropic or ChatGPT reports it. A window that does not
 *  fit becomes null rather than failing: the good windows beside it still count. */
const usageWindowSchema = z
  .object({
    utilization: z.number().optional(),
    resets_at: z.string().max(60).nullable().optional(),
    used_percent: z.number().optional(),
    limit_window_seconds: z.number().optional(),
    reset_after_seconds: z.number().optional(),
  })
  .nullable()
  .catch(null)

export const localUsageSchema = z.object({
  five_hour: usageWindowSchema.optional(),
  seven_day: usageWindowSchema.optional(),
  seven_day_opus: usageWindowSchema.optional(),
  seven_day_sonnet: usageWindowSchema.optional(),
  plan_type: z.string().max(60).optional(),
  rate_limit: z
    .object({
      primary_window: usageWindowSchema.optional(),
      secondary_window: usageWindowSchema.optional(),
    })
    .nullable()
    .optional(),
  credits: codexCreditsSchema,
})
