/**
 * Read-only reconciliation: what Mongo recorded vs what GCP billed, for one
 * complete UTC day (default D-2, because the billing export is still landing
 * rows for D-1).
 *
 * It NEVER writes — not to Mongo, not to BigQuery. The BigQuery half is not run
 * for you either: the script prints the exact SELECT to run with `bq`, then
 * accepts its JSON back so the comparison is reproducible and auditable.
 *
 *   # 1. see the Mongo side + the query to run
 *   bun run scripts/reconcile-vertex-billing.ts \
 *     --billing-project my-billing-project \
 *     --gcp-project nuphos \
 *     --export-table billing.gcp_billing_export_v1_0123 \
 *     --model-id claude-opus-5 \
 *     --sku-filter 'Claude Opus 5' \
 *     --day 2026-08-01
 *
 *   # 2. run the printed SELECT yourself, then feed the result back
 *   bq query --nouse_legacy_sql --format=json "<the printed SQL>" > /tmp/bq.json
 *   bun run scripts/reconcile-vertex-billing.ts ... --bq-json /tmp/bq.json
 *
 * --gcp-project is REQUIRED and is never inferred from `gcloud config`: a
 * reconciliation that silently picks up whatever project the operator last
 * selected can compare two unrelated environments and look correct doing it.
 *
 * Residual deltas that are NOT bugs, and cannot be closed from our side:
 *   - Streams that die mid-round. The AI SDK's onError callback carries only
 *     the error, never a usage object, and onFinish never runs — so the tokens
 *     the provider already generated (and billed) have no number we could
 *     honestly record. These show up as Mongo < BigQuery. Inventing a figure
 *     would be worse than the gap.
 *   - Rounding. GCP bills per-SKU on its own aggregation of the day; we sum
 *     per-call floats. Expect sub-cent disagreement on a full day.
 *   - Committed-use / negotiated discounts and credits land in the export's
 *     cost column but not in our list-price table, so a discounted account
 *     will show Mongo > BigQuery by the discount.
 */
import { readFileSync } from 'node:fs'

import { connectDb } from '@/lib/db'
import { agentTokenUsage } from '@/lib/agent/token-usage-db'
import {
  DEFAULT_VERTEX_PROVIDERS,
  bigQueryAmount,
  bigQueryReconcileSql,
  mongoReconcilePipeline,
  reconcileDayWindow,
  reconcileReport,
  tokenClassForSkuDescription,
} from '@/lib/agent/token-usage-reconcile'

import type { ReconcileTokenClass, ReconcileTokenTotals } from '@/lib/agent/token-usage-reconcile'

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)

  return index === -1 ? undefined : process.argv[index + 1]
}

function required(name: string): string {
  const value = flag(name)

  if (!value) {
    console.error(`--${name} is required`)
    process.exit(1)
  }

  return value
}

type BqRow = { sku_description: string; tokens: string | number; cost_usd: string | number }

/** Fold `bq --format=json` rows into our four classes. Unmapped SKUs are
 *  reported, never silently folded into a bucket they don't belong to. */
function foldBigQueryRows(rows: BqRow[]): {
  totals: ReconcileTokenTotals & { costUsd: number }
  unmapped: string[]
} {
  const totals: ReconcileTokenTotals & { costUsd: number } = { costUsd: 0 }
  const unmapped: string[] = []

  for (const row of rows) {
    const tokenClass: ReconcileTokenClass | null = tokenClassForSkuDescription(row.sku_description)

    if (!tokenClass) {
      unmapped.push(row.sku_description)
      continue
    }
    // bigQueryAmount, not Number(): bq returns numbers as strings, and a
    // missing or malformed field would otherwise fold NaN into the totals,
    // where every delta reads as "no data" rather than "broken input".
    totals[tokenClass] = (totals[tokenClass] ?? 0) + bigQueryAmount(row.tokens)
    totals.costUsd += bigQueryAmount(row.cost_usd)
  }

  return { totals, unmapped }
}

async function main(): Promise<void> {
  const billingProject = required('billing-project')
  const gcpProject = required('gcp-project')
  const exportTable = required('export-table')
  const modelId = required('model-id')
  const skuFilter = required('sku-filter')
  const providerFlag = flag('provider')
  const provider = providerFlag
    ? providerFlag
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    : [...DEFAULT_VERTEX_PROVIDERS]
  const window = reconcileDayWindow(new Date(), flag('day'))
  const bqJsonPath = flag('bq-json')

  await connectDb()
  const mongoRows = await agentTokenUsage()
    .aggregate<ReconcileTokenTotals & { modelId: string }>(
      mongoReconcilePipeline({
        window,
        provider,
        // Only rows written after gcpProject shipped carry it; scoping on it
        // would silently drop the entire history, so it is opt-in.
        ...(process.argv.includes('--scope-gcp-project') ? { gcpProject } : {}),
        ...(flag('model-id') ? { modelId: flag('model-id') } : {}),
      }),
    )
    .toArray()

  // billingProject owns the export dataset; gcpProject is the project the
  // Vertex calls were billed TO. They are frequently different, so both are
  // required and neither substitutes for the other.
  const sql = bigQueryReconcileSql({ billingProject, gcpProject, exportTable, window, skuFilter })

  if (!bqJsonPath) {
    console.log(JSON.stringify({ window, billingProject, gcpProject, mongo: mongoRows }, null, 2))
    console.log('\n-- Run this, then re-run with --bq-json <file>:\n')
    console.log(sql)
    process.exit(0)
  }

  const { totals, unmapped } = foldBigQueryRows(
    JSON.parse(readFileSync(bqJsonPath, 'utf8')) as BqRow[],
  )
  // One model per report: --model-id is required, because mixing models would
  // average four different SKU rate cards into a single meaningless delta.
  const mongo = mongoRows
    .filter((row) => row.modelId === modelId)
    .reduce<ReconcileTokenTotals>((acc, row) => {
      for (const key of [
        'uncachedInputTokens',
        'cachedInputTokens',
        'cacheWriteTokens',
        'outputTokens',
      ] as ReconcileTokenClass[]) {
        acc[key] = (acc[key] ?? 0) + (row[key] ?? 0)
      }

      return acc
    }, {})

  console.log(
    JSON.stringify(
      {
        window,
        gcpProject,
        readOnly: true,
        unmappedSkus: unmapped,
        ...reconcileReport({ modelId, mongo, bigQuery: totals }),
      },
      null,
      2,
    ),
  )
  process.exit(0)
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
