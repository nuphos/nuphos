import { describe, expect, test } from 'bun:test'

import { panelOutputSchema, outputMatchesKind } from '@/lib/dashboards/panel-output'

describe('panelOutputSchema', () => {
  test('accepts a valid chart payload (ChartPayload-shaped)', () => {
    const r = panelOutputSchema.safeParse({
      kind: 'chart',
      type: 'area',
      title: 'Spend',
      xKey: 'date',
      series: [{ key: 'usd', label: 'USD' }],
      data: [
        { date: '2026-07-01', usd: 12 },
        { date: '2026-07-02', usd: null },
      ],
    })

    expect(r.success).toBe(true)
  })

  test('rejects a chart row whose series cell is not number|null', () => {
    const r = panelOutputSchema.safeParse({
      kind: 'chart',
      type: 'line',
      title: 'Spend',
      xKey: 'date',
      series: [{ key: 'usd' }],
      data: [{ date: '2026-07-01', usd: 'oops' }],
    })

    expect(r.success).toBe(false)
  })

  test('rejects a chart row missing the xKey', () => {
    const r = panelOutputSchema.safeParse({
      kind: 'chart',
      type: 'bar',
      title: 'Spend',
      xKey: 'date',
      series: [{ key: 'usd' }],
      data: [{ usd: 5 }],
    })

    expect(r.success).toBe(false)
  })

  test('accepts scalar and defaults unit to usd', () => {
    const r = panelOutputSchema.safeParse({ kind: 'scalar', title: 'Total', value: 17442 })

    expect(r.success).toBe(true)
    if (r.success && r.data.kind === 'scalar') expect(r.data.unit).toBe('usd')
  })

  test('accepts a table payload', () => {
    const r = panelOutputSchema.safeParse({
      kind: 'table',
      title: 'By service',
      columns: [{ key: 'name' }, { key: 'usd', numeric: true }],
      rows: [{ name: 'cpx32', usd: 970 }],
    })

    expect(r.success).toBe(true)
  })

  test('outputMatchesKind guards panel/output agreement', () => {
    const chart = panelOutputSchema.parse({
      kind: 'chart',
      type: 'area',
      title: 't',
      xKey: 'x',
      series: [{ key: 'y' }],
      data: [{ x: '1', y: 1 }],
    })

    expect(outputMatchesKind(chart, 'chart')).toBe(true)
    expect(outputMatchesKind(chart, 'scalar')).toBe(false)
  })
})
