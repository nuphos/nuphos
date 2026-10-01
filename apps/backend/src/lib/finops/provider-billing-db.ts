import { db } from '@/lib/db'
import { logError } from '@/lib/observability'

import type { Collection } from 'mongodb'

/**
 * One day of what the provider actually invoiced, for one service and SKU.
 *
 * Stored at SKU granularity even though the UI rolls up to service: rolling up
 * later is free, re-syncing history to gain detail is not. `cost` is the
 * export's own figure — before credits and before any reseller discount, which
 * is the number the monthly invoice is built from.
 */
export type ProviderBillingDay = {
  /** `<provider>:<day>:<service>:<sku>` — makes the sync a plain idempotent upsert. */
  _id: string
  provider: 'gcp'
  /** UTC midnight of the usage day. */
  day: Date
  service: string
  sku: string
  costUsd: number
  currency: string
  /** Last time a sync wrote this row; a stale value means the sync is broken. */
  syncedAt: Date
}

const COLLECTION_NAME = 'finops_provider_billing'

export const providerBilling = (): Collection<ProviderBillingDay> =>
  db().collection<ProviderBillingDay>(COLLECTION_NAME)

export async function setupProviderBillingIndexes(): Promise<void> {
  try {
    // The only read pattern: a date range, optionally narrowed to a provider.
    await providerBilling().createIndex({ day: 1, provider: 1 }, { background: true })
  } catch (err) {
    logError('finops.provider_billing.indexes_create_failed', err)
  }
}

export function billingRowId(provider: string, day: Date, service: string, sku: string): string {
  return `${provider}:${day.toISOString().slice(0, 10)}:${service}:${sku}`
}
