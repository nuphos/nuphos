import { describe, expect, test } from 'bun:test'

import { byCodeUnit } from './sort-order'

import {
  DEFAULT_VERTEX_PROVIDERS,
  bigQueryAmount,
  bigQueryReconcileSql,
  mongoReconcilePipeline,
  reconcileDayWindow,
  reconcileReport,
  tokenClassForSkuDescription,
} from './token-usage-reconcile'

describe('reconcileDayWindow', () => {
  test('defaults to the last COMPLETE UTC day pair (D-2), never a partial day', () => {
    // GCP billing export lags; D-1 is still filling in when D ends.
    const window = reconcileDayWindow(new Date('2026-08-08T07:41:00Z'))

    expect(window.day).toBe('2026-08-06')
    expect(window.from.toISOString()).toBe('2026-08-06T00:00:00.000Z')
    expect(window.to.toISOString()).toBe('2026-08-07T00:00:00.000Z')
  })

  test('an explicit day is honoured and is always a full UTC day', () => {
    const window = reconcileDayWindow(new Date('2026-08-08T07:41:00Z'), '2026-07-31')

    expect(window.from.toISOString()).toBe('2026-07-31T00:00:00.000Z')
    expect(window.to.toISOString()).toBe('2026-08-01T00:00:00.000Z')
  })

  test('rejects a day that is not a bare UTC calendar date', () => {
    expect(() => reconcileDayWindow(new Date(), '2026-07-31T05:00:00Z')).toThrow()
    expect(() => reconcileDayWindow(new Date(), 'yesterday')).toThrow()
  })
})

describe('bigQueryReconcileSql', () => {
  const window = reconcileDayWindow(new Date('2026-08-08T00:00:00Z'), '2026-08-01')

  test('takes the billing project from the caller and never from ambient gcloud state', () => {
    const sql = bigQueryReconcileSql({
      billingProject: 'zeabur-billing',
      gcpProject: 'nuphos',
      exportTable: 'billing.gcp_billing_export_v1_0123',
      window,
      skuFilter: 'Claude Opus 5',
    })

    expect(sql).toContain('zeabur-billing')
    expect(sql).toContain("project.id = 'nuphos'")
    expect(sql).toContain('billing.gcp_billing_export_v1_0123')
    expect(sql).toContain('2026-08-01')
    expect(sql).toContain("service.description LIKE 'Claude%'")
    expect(sql).toContain("sku.description LIKE '%Claude Opus 5%'")
    expect(sql).not.toContain("service.description LIKE '%Vertex%'")
  })

  test('refuses to run without an explicit project', () => {
    expect(() =>
      bigQueryReconcileSql({
        billingProject: '',
        gcpProject: 'nuphos',
        exportTable: 'billing.export',
        window,
        skuFilter: 'Claude Opus 5',
      }),
    ).toThrow(/project/i)
  })

  test('is read-only: no DML ever reaches BigQuery', () => {
    const sql = bigQueryReconcileSql({
      billingProject: 'zeabur-billing',
      gcpProject: 'nuphos',
      exportTable: 'billing.export',
      window,
      skuFilter: 'Claude Opus 5',
    }).toUpperCase()

    for (const verb of ['INSERT ', 'UPDATE ', 'DELETE ', 'MERGE ', 'CREATE ', 'DROP ']) {
      expect(sql).not.toContain(verb)
    }
  })
})

describe('tokenClassForSkuDescription', () => {
  test('maps the four Vertex Claude SKUs onto our four token classes', () => {
    expect(tokenClassForSkuDescription('Claude Opus 5 Input')).toBe('uncachedInputTokens')
    expect(tokenClassForSkuDescription('Claude Opus 5 Cache Read')).toBe('cachedInputTokens')
    expect(tokenClassForSkuDescription('Claude Opus 5 5-minute Cache Write')).toBe(
      'cacheWriteTokens',
    )
    expect(tokenClassForSkuDescription('Claude Opus 5 Output')).toBe('outputTokens')
  })

  test('cache write wins over the bare "input" substring in its own SKU name', () => {
    expect(tokenClassForSkuDescription('Claude Opus 5 Cache Write Input Tokens')).toBe(
      'cacheWriteTokens',
    )
  })

  test('an unrecognised SKU is reported as unknown rather than silently bucketed', () => {
    expect(tokenClassForSkuDescription('Cloud Storage Standard Storage')).toBeNull()
  })
})

describe('mongoReconcilePipeline', () => {
  const window = reconcileDayWindow(new Date('2026-08-08T00:00:00Z'), '2026-08-01')

  test('is a read-only aggregation scoped to the day and the Vertex provider', () => {
    const pipeline = mongoReconcilePipeline({ window, provider: 'vertex.anthropic' })
    const match = (pipeline[0] as any).$match

    expect(match.provider).toBe('vertex.anthropic')
    expect(match.createdAt).toEqual({ $gte: window.from, $lt: window.to })
    expect(JSON.stringify(pipeline)).not.toContain('$merge')
    expect(JSON.stringify(pipeline)).not.toContain('$out')
  })

  test('can include both historical Vertex provider aliases without Bedrock', () => {
    const pipeline = mongoReconcilePipeline({
      window,
      provider: ['vertex.anthropic', 'vertex.anthropic.messages'],
    })
    const match = (pipeline[0] as any).$match

    expect(match.provider).toEqual({
      $in: ['vertex.anthropic', 'vertex.anthropic.messages'],
    })
  })

  test('scopes to one GCP project when the caller names one', () => {
    const pipeline = mongoReconcilePipeline({
      window,
      provider: 'vertex.anthropic',
      gcpProject: 'nuphos-prod',
    })

    expect((pipeline[0] as any).$match.gcpProject).toBe('nuphos-prod')
  })
})

describe('reconcileReport', () => {
  // The verified 2026-07-31..08-07 window, collapsed into one row.
  const bq = {
    uncachedInputTokens: 39_480_408,
    cachedInputTokens: 417_763_199,
    cacheWriteTokens: 58_777_038,
    outputTokens: 2_843_501,
    costUsd: 844.727509,
  }

  test('prices Mongo tokens with the SKU rates and reports the per-class delta', () => {
    const report = reconcileReport({
      modelId: 'claude-opus-5',
      mongo: {
        uncachedInputTokens: bq.uncachedInputTokens,
        cachedInputTokens: bq.cachedInputTokens,
        cacheWriteTokens: bq.cacheWriteTokens,
        outputTokens: bq.outputTokens,
      },
      bigQuery: bq,
    })

    expect(report.mongo.costUsd).toBeCloseTo(844.727652, 6)
    expect(Math.abs(report.costDeltaUsd)).toBeLessThan(0.001)
    for (const value of Object.values(report.tokenDeltas)) expect(value).toBe(0)
  })

  test('surfaces the pre-fix under-count as a negative cost delta', () => {
    // What the old formula produced: cache writes billed as plain input.
    const underBilled =
      (bq.uncachedInputTokens * 5 +
        bq.cachedInputTokens * 0.5 +
        bq.cacheWriteTokens * 5 +
        bq.outputTokens * 25) /
      1e6
    const report = reconcileReport({
      modelId: 'claude-opus-5',
      mongo: { ...bq, cacheWriteTokens: 0, uncachedInputTokens: bq.uncachedInputTokens },
      bigQuery: bq,
    })

    expect(bq.costUsd - underBilled).toBeCloseTo(73.47, 1)
    expect(report.tokenDeltas.cacheWriteTokens).toBe(-bq.cacheWriteTokens)
    expect(report.costDeltaUsd).toBeLessThan(0)
  })

  test('missing Mongo rows show up as a shortfall, not as a crash', () => {
    const report = reconcileReport({
      modelId: 'claude-opus-5',
      mongo: {},
      bigQuery: bq,
    })

    expect(report.mongo.costUsd).toBe(0)
    expect(report.costDeltaUsd).toBeCloseTo(-bq.costUsd, 6)
  })
})

describe('DEFAULT_VERTEX_PROVIDERS', () => {
  test('covers both historical Vertex labels and never Bedrock', () => {
    expect([...DEFAULT_VERTEX_PROVIDERS].sort(byCodeUnit)).toEqual([
      'vertex.anthropic',
      'vertex.anthropic.messages',
    ])
    expect(DEFAULT_VERTEX_PROVIDERS).not.toContain('amazon-bedrock')
  })

  test('is what the pipeline matches on when no provider is named', () => {
    const pipeline = mongoReconcilePipeline({
      window: reconcileDayWindow(new Date('2026-08-08T00:00:00Z'), '2026-08-01'),
      provider: DEFAULT_VERTEX_PROVIDERS,
    })

    expect((pipeline[0] as any).$match.provider).toEqual({ $in: [...DEFAULT_VERTEX_PROVIDERS] })
  })
})

describe('hostile and impossible CLI input', () => {
  test('rejects a calendar date that does not exist', () => {
    // JS silently rolls 2026-02-31 forward to 2026-03-03, so the report would
    // claim one day while querying another.
    expect(() => reconcileDayWindow(new Date(), '2026-02-31')).toThrow(/2026-02-31/)
    expect(() => reconcileDayWindow(new Date(), '2026-13-01')).toThrow()
    expect(() => reconcileDayWindow(new Date(), '2025-02-29')).toThrow()
  })

  test('accepts a real leap day', () => {
    expect(reconcileDayWindow(new Date(), '2028-02-29').from.toISOString()).toBe(
      '2028-02-29T00:00:00.000Z',
    )
  })

  test('rejects identifiers that could break out of the SQL', () => {
    const window = reconcileDayWindow(new Date('2026-08-08T00:00:00Z'), '2026-08-01')
    const hostile = [
      'p`; DROP TABLE x; --',
      'p`.`other',
      "p' OR '1'='1",
      'p;x',
      'p x',
      '',
      'a'.repeat(2000),
    ]

    for (const value of hostile) {
      expect(() =>
        bigQueryReconcileSql({
          billingProject: value,
          gcpProject: 'nuphos',
          exportTable: 'billing.export',
          window,
          skuFilter: 'Claude Opus 5',
        }),
      ).toThrow()
      expect(() =>
        bigQueryReconcileSql({
          billingProject: 'zeabur-billing',
          gcpProject: 'nuphos',
          exportTable: value,
          window,
          skuFilter: 'Claude Opus 5',
        }),
      ).toThrow()
    }
  })

  test('accepts the identifier shapes GCP actually issues', () => {
    const window = reconcileDayWindow(new Date('2026-08-08T00:00:00Z'), '2026-08-01')

    expect(() =>
      bigQueryReconcileSql({
        billingProject: 'zeabur-billing-1',
        gcpProject: 'nuphos',
        exportTable: 'billing.gcp_billing_export_v1_0123AB_CD_EF',
        window,
        skuFilter: 'Claude Opus 5',
      }),
    ).not.toThrow()
  })

  test('a quote in a VALUE is escaped rather than rejected, and cannot end the literal', () => {
    const sql = bigQueryReconcileSql({
      billingProject: 'zeabur-billing',
      gcpProject: 'nuphos',
      exportTable: 'billing.export',
      window: reconcileDayWindow(new Date('2026-08-08T00:00:00Z'), '2026-08-01'),
      skuFilter: "Claude ' OR 1=1 --",
    })

    // Doubled quote: the literal never terminates, so the injected tail stays
    // inside the LIKE pattern instead of becoming SQL.
    expect(sql).toContain("Claude '' OR 1=1 --")
    expect(sql.split('\n').filter((line) => line.includes('LIKE'))).toHaveLength(2)
    expect(sql).not.toContain("'Claude ' OR 1=1")
  })
})

describe('BigQuery numeric parsing fails closed', () => {
  test('rejects a non-numeric or missing amount instead of silently reading NaN', () => {
    expect(() => bigQueryAmount('12345')).not.toThrow()
    expect(bigQueryAmount('12345')).toBe(12_345)
    expect(bigQueryAmount(12.5)).toBe(12.5)
    for (const bad of ['', 'n/a', null, undefined, {}, Number.NaN, Infinity]) {
      expect(() => bigQueryAmount(bad as never)).toThrow()
    }
  })
})

// Regression cover for two blockers an earlier review raised that are already
// fixed, so they cannot silently regress: the export-HOST project must not be
// conflated with the resource project being reconciled, and one report must
// cover exactly one model.
describe('BQ scoping is per resource project and per model', () => {
  const window = reconcileDayWindow(new Date('2026-08-08T00:00:00Z'), '2026-08-01')
  const sql = bigQueryReconcileSql({
    billingProject: 'zeabur-billing',
    gcpProject: 'nuphos',
    exportTable: 'billing.gcp_billing_export_v1_0123',
    window,
    skuFilter: 'Claude Opus 5',
  })

  test('the export host project only qualifies the table; project.id scopes the rows', () => {
    expect(sql).toContain('FROM `zeabur-billing.billing.gcp_billing_export_v1_0123`')
    expect(sql).toContain("AND project.id = 'nuphos'")
    // The reverse would silently reconcile the billing project's own usage.
    expect(sql).not.toContain("project.id = 'zeabur-billing'")
  })

  test('the SKU filter is model-specific, never a bare Claude wildcard', () => {
    expect(sql).toContain("sku.description LIKE '%Claude Opus 5%'")
    expect(sql).not.toContain("sku.description LIKE '%Claude%'")
  })

  test('a multi-project, multi-model export cannot leak in through defaults', () => {
    // Every scoping input is required; none has a permissive default.
    for (const missing of ['billingProject', 'gcpProject', 'skuFilter'] as const) {
      const args = {
        billingProject: 'zeabur-billing',
        gcpProject: 'nuphos',
        exportTable: 'billing.export',
        window,
        skuFilter: 'Claude Opus 5',
      }

      expect(() => bigQueryReconcileSql({ ...args, [missing]: '' })).toThrow()
    }
  })
})
