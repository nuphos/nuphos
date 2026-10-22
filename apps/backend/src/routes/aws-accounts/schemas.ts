import { z } from 'zod'

import { cloudRegionSchema } from '@/lib/byos/cloud-region'

export const optionalRegionQuerySchema = z.object({
  region: cloudRegionSchema.optional(),
})
