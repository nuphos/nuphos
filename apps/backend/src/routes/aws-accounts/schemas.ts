import { z } from 'zod'

export const optionalRegionQuerySchema = z.object({
  region: z.string().trim().min(1).optional(),
})
