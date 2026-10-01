import { providerBilling } from '@/lib/finops/provider-billing-db'

import type { FinopsRange } from '@/lib/agent/finops-range'

export type BilledService = {
  provider: string
  service: string
  costUsd: number
  /** Counted toward modelCostUsd — see isModelService. */
  isModel: boolean
}

/**
 * GCP invoices each Claude model as its own service ("Claude Opus 5"), with
 * Vertex AI / Gemini API alongside it. Everything else on the bill is
 * infrastructure (Compute Engine, GKE, networking) and must not be compared
 * against a token-derived figure.
 *
 * This matches on a provider-controlled string, so the classification is shown
 * per service in the UI rather than folded silently into one number.
 */
export function isModelService(service: string): boolean {
  return service.startsWith('Claude ') || service === 'Vertex AI' || service === 'Gemini API'
}

export type BilledSummary = {
  /** Everything the provider invoiced for our project over the range, before
   *  credits and before any reseller discount. Includes infrastructure. */
  costUsd: number
  /** The model-inference part only — the figure comparable to the derived
   *  token cost. */
  modelCostUsd: number
  services: BilledService[]
  /** When the sync last wrote — stale means the numbers below are stale. */
  syncedAt: string | null
  /** Last usage day present, so a partial final day is visible as such. */
  throughDay: string | null
  /**
   * The window billing actually covers inside the requested range. Billing
   * lags by hours and only exists from the day the sync started, so this is
   * usually shorter than the range — and comparing a full range's derived cost
   * against a partial bill invents a gap in whichever direction the shortfall
   * happens to lie.
   */
  coverageSince: string | null
  coverageUntil: string | null
}

/**
 * Billed cost for a range, or null when no billing has ever been synced.
 *
 * Null is not zero: a page that shows $0.00 billed next to a real derived cost
 * would read as "we are not being charged", when it actually means the export
 * is not wired up.
 */
export async function getBilledSummary(range: FinopsRange): Promise<BilledSummary | null> {
  const day = range.until ? { $gte: range.since, $lt: range.until } : { $gte: range.since }
  const rows = await providerBilling()
    .aggregate<{ _id: { provider: string; service: string }; costUsd: number }>([
      { $match: { day } },
      {
        $group: {
          _id: { provider: '$provider', service: '$service' },
          costUsd: { $sum: '$costUsd' },
        },
      },
      { $sort: { costUsd: -1 } },
    ])
    .toArray()

  const [latest] = await providerBilling()
    .find({}, { projection: { syncedAt: 1, day: 1 }, sort: { syncedAt: -1 }, limit: 1 })
    .toArray()

  if (!latest) return null
  const [newestDay] = await providerBilling()
    .find({ day }, { projection: { day: 1 }, sort: { day: -1 }, limit: 1 })
    .toArray()
  const [oldestDay] = await providerBilling()
    .find({ day }, { projection: { day: 1 }, sort: { day: 1 }, limit: 1 })
    .toArray()
  // Exclusive upper bound: a day present in the export is billed in full.
  const coverageUntil = newestDay ? new Date(newestDay.day) : null

  if (coverageUntil) coverageUntil.setUTCDate(coverageUntil.getUTCDate() + 1)

  const services = rows.map((row) => ({
    provider: row._id.provider,
    service: row._id.service,
    costUsd: row.costUsd,
    isModel: isModelService(row._id.service),
  }))

  return {
    costUsd: services.reduce((sum, row) => sum + row.costUsd, 0),
    modelCostUsd: services.filter((row) => row.isModel).reduce((sum, row) => sum + row.costUsd, 0),
    services,
    syncedAt: latest.syncedAt.toISOString(),
    throughDay: newestDay ? newestDay.day.toISOString().slice(0, 10) : null,
    coverageSince: oldestDay ? oldestDay.day.toISOString() : null,
    coverageUntil: coverageUntil ? coverageUntil.toISOString() : null,
  }
}
