import { AppError } from '@/lib/errors'

import { gcpWifConfigured } from './gcp-wif'

import type { impersonateSa } from './gcp'

export function clientOptionsFor(impersonated: Awaited<ReturnType<typeof impersonateSa>>) {
  return { authClient: impersonated as never }
}

export function ensureConfigured(): void {
  if (!gcpWifConfigured()) {
    throw new AppError(
      503,
      'gcp_federation_unavailable',
      'GCP workload identity federation is not configured on this server.',
    )
  }
}
