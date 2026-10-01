import { BigQuery } from '@google-cloud/bigquery'

import { config } from '@/config'
import { billingRowId, providerBilling } from '@/lib/finops/provider-billing-db'
import { logError, logEvent } from '@/lib/observability'

import type { ProviderBillingDay } from '@/lib/finops/provider-billing-db'

export type BillingRow = {
  day: { value: string } | string
  service: string | null
  sku: string | null
  cost: number | null
  currency: string | null
}

let client: BigQuery | null = null
let syncTimer: ReturnType<typeof setInterval> | null = null
let warmupTimer: ReturnType<typeof setTimeout> | null = null

function tableParts(table: string): { projectId: string; rest: string } | null {
  const [projectId, dataset, name] = table.split('.')

  if (!projectId || !dataset || !name) return null

  return { projectId, rest: `${dataset}.${name}` }
}

function bigQuery(jobProjectId: string): BigQuery {
  // Credentials come from the ambient service account (Workload Identity in
  // GKE, ADC locally) — deliberately no key material in env.
  client ??= new BigQuery({ projectId: jobProjectId })

  return client
}

/**
 * Export rows to storable documents. Pure, and separated from the query so the
 * transform can be exercised against real row shapes without BigQuery
 * credentials — the client only authenticates in an environment that has a
 * service account, which dev machines generally do not.
 */
export function rowsToDocuments(rows: BillingRow[], syncedAt: Date): ProviderBillingDay[] {
  const documents: ProviderBillingDay[] = []

  for (const row of rows) {
    const day = dayFromRow(row.day)

    if (!day) continue
    const service = row.service ?? 'unknown'
    const sku = row.sku ?? 'unknown'

    documents.push({
      _id: billingRowId('gcp', day, service, sku),
      provider: 'gcp',
      day,
      service,
      sku,
      costUsd: row.cost ?? 0,
      currency: row.currency ?? 'USD',
      syncedAt,
    })
  }

  return documents
}

export async function writeBillingDocuments(documents: ProviderBillingDay[]): Promise<void> {
  if (!documents.length) return
  // Deterministic ids make this idempotent: a row that the export revises
  // between syncs is overwritten, never added twice.
  await providerBilling().bulkWrite(
    documents.map((doc) => ({
      replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true },
    })),
    { ordered: false },
  )
}

function dayFromRow(value: BillingRow['day']): Date | null {
  const raw = typeof value === 'string' ? value : value.value
  const parsed = new Date(`${raw.slice(0, 10)}T00:00:00.000Z`)

  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * The window's lower bound is a DAY BOUNDARY, not `CURRENT_TIMESTAMP` minus N
 * days. A rolling cutoff lands mid-day, so the oldest day in the window comes
 * back partial — and because the upsert is keyed by day, that partial value
 * overwrites the complete one an earlier sync stored. The totals still look
 * plausible, which is what makes it worth a test.
 */
export function buildBillingQuery(table: string): string {
  return `
      SELECT
        DATE(usage_start_time) AS day,
        service.description AS service,
        sku.description AS sku,
        SUM(cost) AS cost,
        ANY_VALUE(currency) AS currency
      FROM \`${table}\`
      WHERE project.id = @gcpProjectId
        AND usage_start_time >= TIMESTAMP(DATE_SUB(CURRENT_DATE(), INTERVAL @days DAY))
      GROUP BY 1, 2, 3
      HAVING cost != 0`
}

/**
 * Pull the last `lookbackDays` of billed cost for our GCP project and upsert it.
 *
 * The export keeps appending rows for a usage hour well after that hour ends,
 * so each run re-reads the whole window and overwrites — never accumulates —
 * which is why the row id is deterministic.
 */
export async function syncProviderBilling(): Promise<{ rows: number; costUsd: number } | null> {
  const settings = config.providerBilling
  const table = settings.bigQueryTable

  if (!table) return null
  const parts = tableParts(table)

  if (!parts) {
    logError('finops.provider_billing.bad_table', new Error(`not project.dataset.table: ${table}`))

    return null
  }

  const [rows] = await bigQuery(settings.bigQueryProjectId ?? parts.projectId).query({
    query: buildBillingQuery(table),
    params: { gcpProjectId: settings.gcpProjectId, days: settings.lookbackDays },
    // The table is DAY-partitioned on usage_start_time; the predicate above
    // prunes to the window, so this ceiling only catches a schema change that
    // silently turns the scan into a full-table read.
    maximumBytesBilled: String(2 * 1024 * 1024 * 1024),
  })

  const documents = rowsToDocuments(rows as BillingRow[], new Date())

  await writeBillingDocuments(documents)
  const costUsd = documents.reduce((sum, doc) => sum + doc.costUsd, 0)

  logEvent('info', 'finops.provider_billing.synced', {
    rows: documents.length,
    cost_usd: Math.round(costUsd * 100) / 100,
    lookback_days: settings.lookbackDays,
  })

  return { rows: documents.length, costUsd }
}

/** Hourly by default. Returns false when no export table is configured. */
export function initProviderBillingSync(): boolean {
  if (!config.providerBilling.bigQueryTable) return false
  const run = () =>
    void syncProviderBilling().catch((err: unknown) => {
      logError('finops.provider_billing.sync_failed', err)
    })

  // After boot, not during it — a slow BigQuery job must not delay listening.
  warmupTimer = setTimeout(run, 20_000)
  syncTimer = setInterval(run, config.providerBilling.syncIntervalMinutes * 60_000)

  return true
}

export function shutdownProviderBillingSync(): void {
  if (warmupTimer) clearTimeout(warmupTimer)
  if (syncTimer) clearInterval(syncTimer)
}
