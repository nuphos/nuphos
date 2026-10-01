import { describe, expect, test } from 'bun:test'

import { billingRowId } from '@/lib/finops/provider-billing-db'
import { buildBillingQuery, rowsToDocuments } from '@/lib/finops/provider-billing-sync'

import type { BillingRow } from '@/lib/finops/provider-billing-sync'

const SYNCED_AT = new Date('2026-08-11T07:57:00.000Z')

function row(over: Partial<BillingRow> = {}): BillingRow {
  return {
    day: { value: '2026-08-06' },
    service: 'Claude Opus 5',
    sku: 'Claude Opus 5 Input',
    cost: 1.5,
    currency: 'USD',
    ...over,
  }
}

describe('buildBillingQuery', () => {
  // A rolling `CURRENT_TIMESTAMP - N DAY` cutoff lands mid-day, so the oldest
  // day comes back partial and — because the upsert is keyed by day —
  // overwrites the complete value an earlier sync stored. It cost one day
  // $192.52 of its real $296.51 before this was caught, with the total still
  // looking plausible.
  test('starts the window on a day boundary, never a rolling timestamp', () => {
    const sql = buildBillingQuery('proj.dataset.table')

    expect(sql).toContain('TIMESTAMP(DATE_SUB(CURRENT_DATE(), INTERVAL @days DAY))')
    expect(sql).not.toContain('CURRENT_TIMESTAMP')
  })

  test('scopes to our project and never reads the whole export', () => {
    const sql = buildBillingQuery('proj.dataset.table')

    expect(sql).toContain('project.id = @gcpProjectId')
    expect(sql).toContain('`proj.dataset.table`')
  })
})

describe('rowsToDocuments', () => {
  test('ids are deterministic, so a re-sync overwrites instead of accumulating', () => {
    const first = rowsToDocuments([row()], SYNCED_AT)
    const second = rowsToDocuments([row({ cost: 9.75 })], new Date('2026-08-11T08:57:00.000Z'))

    expect(first[0]?._id).toBe(second[0]?._id)
    expect(first[0]?._id).toBe(
      billingRowId(
        'gcp',
        new Date('2026-08-06T00:00:00.000Z'),
        'Claude Opus 5',
        'Claude Opus 5 Input',
      ),
    )
  })

  test('accepts both shapes the day column arrives in', () => {
    const [fromObject] = rowsToDocuments([row()], SYNCED_AT)
    const [fromString] = rowsToDocuments([row({ day: '2026-08-06' })], SYNCED_AT)

    expect(fromObject?.day.toISOString()).toBe('2026-08-06T00:00:00.000Z')
    expect(fromString?.day.toISOString()).toBe(fromObject?.day.toISOString())
  })

  test('drops rows with an unusable day rather than dating them to now', () => {
    expect(rowsToDocuments([row({ day: 'not-a-date' })], SYNCED_AT)).toHaveLength(0)
  })

  test('names missing service and sku instead of losing the cost', () => {
    const [doc] = rowsToDocuments([row({ service: null, sku: null })], SYNCED_AT)

    expect(doc?.service).toBe('unknown')
    expect(doc?.sku).toBe('unknown')
    expect(doc?.costUsd).toBe(1.5)
  })
})
