import { z } from 'zod'

import { AppError } from '@/lib/errors'

/**
 * A cloud region id: lowercase dash-separated labels (`us-east-1`, `cn-beijing`,
 * `ap-southeast-3`). Provider clients interpolate it into API hostnames, so
 * anything else is rejected before it reaches one.
 */
export const cloudRegionSchema = z.string().regex(/^[a-z]{2}(-[a-z0-9]+)+$/, 'Invalid region')

export function assertCloudRegion(region: string): string {
  if (!cloudRegionSchema.safeParse(region).success) {
    throw new AppError(400, 'invalid_region', 'Invalid region')
  }

  return region
}
