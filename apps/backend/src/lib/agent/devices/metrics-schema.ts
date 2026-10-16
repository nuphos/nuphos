import { z } from 'zod'

const capacity = z.object({
  used: z.number().finite().nonnegative(),
  total: z.number().finite().positive(),
})

export const boxMetricsSchema = z.object({
  sampledAt: z.string().datetime(),
  cpuPercent: z.number().finite().min(0).max(100),
  memory: capacity,
  disk: capacity,
})
export type BoxMetrics = z.infer<typeof boxMetricsSchema>
