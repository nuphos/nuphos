// Read-only reconciliation between what Mongo recorded and what GCP actually
// billed, one complete UTC day at a time.
//
// Everything here is pure so the shape of the comparison is testable without a
// live Mongo or BigQuery — the script (scripts/reconcile-vertex-billing.ts)
// supplies the two result sets and prints what this returns.
//
// The billing project is ALWAYS an explicit argument. Reading the ambient
// gcloud project would silently reconcile against whatever the operator last
// ran `gcloud config set project` with, which is exactly how a reconciliation
// tool ends up confidently comparing two unrelated environments.
import { providerCostUsd } from './model-pricing'

import type { Document } from 'mongodb'

export type ReconcileTokenClass =
  'uncachedInputTokens' | 'cachedInputTokens' | 'cacheWriteTokens' | 'outputTokens'

const TOKEN_CLASSES: ReconcileTokenClass[] = [
  'uncachedInputTokens',
  'cachedInputTokens',
  'cacheWriteTokens',
  'outputTokens',
]

// Both labels our Vertex rows have ever carried. Bedrock rows are deliberately
// absent: they are billed by AWS and would inflate the Mongo side of a GCP
// reconciliation with spend the billing export never saw.
export const DEFAULT_VERTEX_PROVIDERS = ['vertex.anthropic', 'vertex.anthropic.messages'] as const

export type ReconcileWindow = {
  /** YYYY-MM-DD, the UTC calendar day being reconciled. */
  day: string
  from: Date
  /** Exclusive. Always exactly 24h after `from`. */
  to: Date
}

// D-2, not D-1: the GCP billing export is still landing rows for yesterday when
// today starts, so comparing against D-1 reports a phantom shortfall.
const RECONCILE_LAG_DAYS = 2

const DAY_MS = 86_400_000
const UTC_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

// GCP project ids and BigQuery dataset/table names, exactly. These land inside
// backtick-quoted SQL identifiers, where escaping is not a thing you can do
// safely — so they are allowlisted, never escaped. A backtick, semicolon,
// space or dot outside the single dataset.table separator is rejected outright.
const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/
const DATASET_TABLE_PATTERN = /^[A-Za-z_]\w{0,1023}\.[A-Za-z_]\w{0,1023}$/

function assertProjectId(label: string, value: string): void {
  if (!PROJECT_ID_PATTERN.test(value)) {
    throw new TypeError(
      `${label} must be a GCP project id (lowercase letters, digits, hyphens; 6-30 chars), got: ${JSON.stringify(value)}`,
    )
  }
}

function assertDatasetTable(value: string): void {
  if (!DATASET_TABLE_PATTERN.test(value)) {
    throw new TypeError(
      `exportTable must be \`dataset.table\` of unquoted BigQuery identifiers, got: ${JSON.stringify(value)}`,
    )
  }
}

export function reconcileDayWindow(now: Date, day?: string): ReconcileWindow {
  const resolved =
    day ?? new Date(now.getTime() - RECONCILE_LAG_DAYS * DAY_MS).toISOString().slice(0, 10)

  if (!UTC_DAY_PATTERN.test(resolved)) {
    throw new TypeError(
      `reconcile day must be a bare UTC calendar date (YYYY-MM-DD), got: ${resolved}`,
    )
  }
  const from = new Date(`${resolved}T00:00:00.000Z`)

  // Date() rolls impossible days forward (2026-02-31 -> 2026-03-03) instead of
  // failing, which would make the report claim one day while querying another.
  // The round-trip is what catches it; Number.isNaN alone does not.
  if (Number.isNaN(from.getTime()) || from.toISOString().slice(0, 10) !== resolved) {
    throw new TypeError(`reconcile day is not a real calendar date: ${resolved}`)
  }

  return { day: resolved, from, to: new Date(from.getTime() + DAY_MS) }
}

// Order matters: the cache-write SKU description contains the word "input"
// too, so it has to be tested before the plain input SKU.
const SKU_PATTERNS: [ReconcileTokenClass, RegExp][] = [
  ['cacheWriteTokens', /cache\s*write/i],
  ['cachedInputTokens', /cache\s*read/i],
  ['outputTokens', /output/i],
  ['uncachedInputTokens', /input/i],
]

/** Which of our four token classes a billing-export SKU description belongs to,
 *  or null when it is not a Claude token SKU at all. */
export function tokenClassForSkuDescription(description: string): ReconcileTokenClass | null {
  for (const [tokenClass, pattern] of SKU_PATTERNS) {
    if (pattern.test(description)) return tokenClass
  }

  return null
}

/** A SELECT over the billing export for one day. Read-only by construction —
 *  the caller runs it with `bq query --use_legacy_sql=false --dry_run` first. */
export function bigQueryReconcileSql(args: {
  billingProject: string
  /** Resource project whose Vertex usage is being reconciled. */
  gcpProject: string
  /** `dataset.table` of the billing export, in the billing project. */
  exportTable: string
  window: ReconcileWindow
  /** Exact model-family fragment, e.g. `Claude Opus 5`; never mix models. */
  skuFilter: string
}): string {
  if (!args.billingProject.trim()) {
    throw new TypeError('bigQueryReconcileSql requires an explicit billingProject — never inferred')
  }
  if (!args.gcpProject.trim()) {
    throw new TypeError('bigQueryReconcileSql requires an explicit gcpProject — never inferred')
  }
  if (!args.skuFilter.trim()) {
    throw new TypeError('bigQueryReconcileSql requires an explicit model-specific skuFilter')
  }
  assertProjectId('billingProject', args.billingProject)
  assertProjectId('gcpProject', args.gcpProject)
  assertDatasetTable(args.exportTable)
  const gcpProject = sqlString(args.gcpProject)
  const skuFilter = sqlString(args.skuFilter)

  return [
    'SELECT',
    '  sku.description AS sku_description,',
    '  SUM(usage.amount) AS tokens,',
    '  SUM(cost) AS cost_usd',
    `FROM \`${args.billingProject}.${args.exportTable}\``,
    `WHERE usage_start_time >= TIMESTAMP('${args.window.from.toISOString()}')`,
    `  AND usage_start_time < TIMESTAMP('${args.window.to.toISOString()}')`,
    `  AND project.id = '${gcpProject}'`,
    `  AND service.description LIKE 'Claude%'`,
    `  AND sku.description LIKE '%${skuFilter}%'`,
    'GROUP BY sku_description',
    'ORDER BY sku_description',
  ].join('\n')
}

function sqlString(value: string): string {
  return value.replace(/'/g, "''")
}

/** The matching Mongo side: one day of Vertex rows, split into the same four
 *  classes. `uncached` is derived the same way pricing derives it, so the two
 *  sides are comparable class by class. */
export function mongoReconcilePipeline(args: {
  window: ReconcileWindow
  provider: string | readonly string[]
  gcpProject?: string
  modelId?: string
}): Document[] {
  return [
    {
      $match: {
        provider: Array.isArray(args.provider) ? { $in: args.provider } : args.provider,
        createdAt: { $gte: args.window.from, $lt: args.window.to },
        ...(args.gcpProject ? { gcpProject: args.gcpProject } : {}),
        ...(args.modelId ? { modelId: args.modelId } : {}),
        kind: { $in: ['input', 'output'] },
      },
    },
    {
      $group: {
        _id: '$modelId',
        inputTokens: {
          $sum: {
            $cond: [{ $eq: ['$kind', 'input'] }, { $ifNull: ['$tokens.inputTokens', 0] }, 0],
          },
        },
        cachedInputTokens: {
          $sum: {
            $cond: [{ $eq: ['$kind', 'input'] }, { $ifNull: ['$tokens.cachedInputTokens', 0] }, 0],
          },
        },
        cacheWriteTokens: {
          $sum: {
            $cond: [{ $eq: ['$kind', 'input'] }, { $ifNull: ['$tokens.cacheWriteTokens', 0] }, 0],
          },
        },
        outputTokens: {
          $sum: {
            $cond: [{ $eq: ['$kind', 'output'] }, { $ifNull: ['$tokens.outputTokens', 0] }, 0],
          },
        },
      },
    },
    {
      $project: {
        _id: 0,
        modelId: '$_id',
        cachedInputTokens: 1,
        cacheWriteTokens: 1,
        outputTokens: 1,
        uncachedInputTokens: {
          $max: [
            0,
            { $subtract: ['$inputTokens', { $add: ['$cachedInputTokens', '$cacheWriteTokens'] }] },
          ],
        },
      },
    },
  ]
}

export type ReconcileTokenTotals = Partial<Record<ReconcileTokenClass, number>>

export type ReconcileReport = {
  modelId: string
  mongo: ReconcileTokenTotals & { costUsd: number }
  bigQuery: ReconcileTokenTotals & { costUsd: number }
  tokenDeltas: Record<ReconcileTokenClass, number>
  costDeltaUsd: number
}

function costForTotals(modelId: string, totals: ReconcileTokenTotals): number {
  const uncached = totals.uncachedInputTokens ?? 0
  const cacheRead = totals.cachedInputTokens ?? 0
  const cacheWrite = totals.cacheWriteTokens ?? 0

  return (
    providerCostUsd({
      modelId,
      // providerCostUsd takes the prompt TOTAL and carves the classes out of it.
      inputTokens: uncached + cacheRead + cacheWrite,
      outputTokens: totals.outputTokens ?? 0,
      cachedInputTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
    }) ?? 0
  )
}

/** Mongo minus BigQuery, per class and in dollars. A negative cost delta means
 *  Mongo under-counted — i.e. we billed ourselves less than GCP billed us. */
export function reconcileReport(args: {
  modelId: string
  mongo: ReconcileTokenTotals
  bigQuery: ReconcileTokenTotals & { costUsd: number }
}): ReconcileReport {
  const mongoCostUsd = costForTotals(args.modelId, args.mongo)
  const tokenDeltas = Object.fromEntries(
    TOKEN_CLASSES.map((key) => [key, (args.mongo[key] ?? 0) - (args.bigQuery[key] ?? 0)]),
  ) as Record<ReconcileTokenClass, number>

  return {
    modelId: args.modelId,
    mongo: { ...args.mongo, costUsd: mongoCostUsd },
    bigQuery: args.bigQuery,
    tokenDeltas,
    costDeltaUsd: mongoCostUsd - args.bigQuery.costUsd,
  }
}

/** A numeric column from `bq --format=json`, which returns every number as a
 *  string. Fails CLOSED: a missing, empty or unparseable amount throws rather
 *  than folding NaN into a total, where it would silently turn the whole
 *  reconciliation into `NaN` deltas that read as "no data" instead of "broken
 *  input". */
export function bigQueryAmount(value: string | number): number {
  if (typeof value === 'string' && value.trim() === '') {
    throw new TypeError('BigQuery returned an empty numeric field')
  }
  // Number('') is 0, which is why the empty case is rejected above rather than
  // left to the finite check.
  const parsed = typeof value === 'number' ? value : Number(value.trim())

  if (!Number.isFinite(parsed)) {
    throw new TypeError(`BigQuery returned a non-numeric amount: ${JSON.stringify(value)}`)
  }

  return parsed
}
