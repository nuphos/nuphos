import type { DashboardPanelOutput } from '@/models'

// A panel snapshot is only bounded by the 512 KB stdout cap, and `staticParams`
// is an unvalidated record — embedding either verbatim can push the request past
// the model's context window, which fails hard with no usable retry. Compact
// large charts and tables into evidence that preserves their important shape,
// rather than slicing off their newest or highest-impact data.
export const MAX_OUTPUT_CHARS = 60_000
export const MAX_PREVIOUS_OUTPUT_CHARS = 20_000
export const MAX_PARAMS_CHARS = 4_000
const TABLE_TOP_ROW_LIMIT = 8

type ChartOutput = Extract<DashboardPanelOutput, { kind: 'chart' }>
type TableOutput = Extract<DashboardPanelOutput, { kind: 'table' }>

type SeriesStats = {
  first: number | null
  latest: number | null
  min: number | null
  max: number | null
  sum: number
  count: number
}

function seriesStats(data: ChartOutput['data'], key: string): SeriesStats {
  const finalValue = data.at(-1)?.[key]
  const stats: SeriesStats = {
    first: null,
    latest: typeof finalValue === 'number' && Number.isFinite(finalValue) ? finalValue : null,
    min: null,
    max: null,
    sum: 0,
    count: 0,
  }

  for (const row of data) {
    const value = row[key]

    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    if (stats.count === 0) stats.first = value
    stats.min = stats.min === null || value < stats.min ? value : stats.min
    stats.max = stats.max === null || value > stats.max ? value : stats.max
    stats.sum += value
    stats.count += 1
  }

  return stats
}

function compactChart(value: ChartOutput, originalCharCount: number): Record<string, unknown> {
  const { data, series } = value
  const first = data[0]
  const last = data.at(-1)
  const samples = data.length < 2 ? data : [first, last]

  return {
    kind: 'chart',
    type: value.type,
    title: value.title,
    ...(value.description === undefined ? {} : { description: value.description }),
    xKey: value.xKey,
    series,
    data: samples,
    compacted: true,
    originalCharCount,
    dataPointCount: data.length,
    seriesSummary: series.map((seriesSpec) => {
      const { first, latest, min, max, sum, count } = seriesStats(data, seriesSpec.key)

      return {
        key: seriesSpec.key,
        latest,
        min,
        max,
        average: count ? sum / count : null,
        delta: first === null || latest === null ? null : latest - first,
        observationCount: count,
      }
    }),
  }
}

function scoreTableRow(row: TableOutput['rows'][number], numericKeys: string[]): number | null {
  const values = numericKeys
    .map((key) => row[key])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))

  return values.length ? values.reduce((sum, value) => sum + Math.abs(value), 0) : null
}

function compactTable(value: TableOutput, originalCharCount: number): Record<string, unknown> {
  const { columns, rows } = value
  const numericKeys = columns.flatMap((column) => (column.numeric === true ? [column.key] : []))
  const ranked = rows
    .map((row, index) => ({ index, row, score: scoreTableRow(row, numericKeys) }))
    .sort(
      (a, b) =>
        (b.score ?? Number.NEGATIVE_INFINITY) - (a.score ?? Number.NEGATIVE_INFINITY) ||
        a.index - b.index,
    )
  const representativeIndexes = rows.length
    ? [...new Set([0, Math.floor(rows.length / 2), rows.length - 1])]
    : []

  return {
    kind: 'table',
    title: value.title,
    columns,
    compacted: true,
    originalCharCount,
    rowCount: rows.length,
    topRows: ranked
      .slice(0, TABLE_TOP_ROW_LIMIT)
      .map(({ row, score }, index) => ({ rank: index + 1, score, row })),
    representativeRows: representativeIndexes.map((index) => ({
      position: index === 0 ? 'first' : index === rows.length - 1 ? 'last' : 'middle',
      index,
      row: rows[index],
    })),
  }
}

function compactValue(value: unknown, originalCharCount: number): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {
      compacted: true,
      originalCharCount,
      valueType: Array.isArray(value) ? 'array' : typeof value,
    }
  }

  const output = value as Partial<DashboardPanelOutput>

  if (output.kind === 'chart') return compactChart(output as ChartOutput, originalCharCount)
  if (output.kind === 'table') return compactTable(output as TableOutput, originalCharCount)

  return { ...(value as Record<string, unknown>), compacted: true, originalCharCount }
}

function truncateStrings(value: unknown, maxStringChars: number): unknown {
  if (typeof value === 'string')
    return value.length <= maxStringChars ? value : `${value.slice(0, maxStringChars)}…`
  if (Array.isArray(value)) return value.map((entry) => truncateStrings(entry, maxStringChars))
  if (typeof value !== 'object' || value === null) return value

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      truncateStrings(entry, maxStringChars),
    ]),
  )
}

export function embedJson(value: unknown, maxChars: number): string {
  const json = JSON.stringify(value) ?? 'null'

  if (json.length <= maxChars) return json

  const compacted = compactValue(value, json.length)
  let bounded = JSON.stringify(compacted) ?? 'null'

  for (
    let maxStringChars = 2_048;
    bounded.length > maxChars && maxStringChars >= 16;
    maxStringChars = Math.floor(maxStringChars / 2)
  ) {
    bounded = JSON.stringify(truncateStrings(compacted, maxStringChars)) ?? 'null'
  }
  if (bounded.length <= maxChars) return bounded

  return (
    JSON.stringify({
      compacted: true,
      originalCharCount: json.length,
      note: 'Value omitted because even its compact form exceeded the embedding budget.',
    }) ?? 'null'
  )
}
