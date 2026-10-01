import { z } from 'zod'

import { presetWindow } from '@/lib/dashboards/exec-service'

import type { NuphosDashboard } from '@/models'

/** Request-local range; never written back to the dashboard definition. */
export const dashboardViewSchema = z
  .object({
    preset: z.enum(['last7', 'last14', 'last30', 'thisMonth', 'prevMonth']).optional(),
    periodStart: z.string().datetime().optional(),
    periodEnd: z.string().datetime().optional(),
    granularity: z.enum(['day', 'week', 'month']).optional(),
  })
  .superRefine((q, ctx) => {
    if (
      Boolean(q.periodStart) !== Boolean(q.periodEnd) ||
      (q.preset && (q.periodStart || q.periodEnd)) ||
      (q.periodStart && q.periodEnd && Date.parse(q.periodStart) >= Date.parse(q.periodEnd))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Use a preset or a complete, increasing time range',
      })
    }
  })

export function dashboardForView(
  dashboard: NuphosDashboard,
  query: z.infer<typeof dashboardViewSchema>,
): NuphosDashboard {
  const preset = query.preset ?? (query.periodStart ? undefined : dashboard.rangePreset)
  const range = preset
    ? presetWindow(preset)
    : query.periodStart && query.periodEnd
      ? { periodStart: new Date(query.periodStart), periodEnd: new Date(query.periodEnd) }
      : dashboard.timeRange

  return {
    ...dashboard,
    // The concrete window is already resolved. The executor must not advance or
    // persist a viewer's preset through advanceRelativeWindow.
    rangePreset: undefined,
    timeRange: { ...range, granularity: query.granularity ?? dashboard.timeRange.granularity },
  }
}
