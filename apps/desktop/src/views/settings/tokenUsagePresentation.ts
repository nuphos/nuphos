import { t } from '../../i18n/index.ts'

import type { TeamUsageNames, TeamUsageRow, UsageDimension } from '../../types/usage'

export const TOKEN_USAGE_RANGES = {
  '7d': { days: 7, label: t('7d') },
  '30d': { days: 30, label: t('30d') },
  '90d': { days: 90, label: t('90d') },
} as const

export type TokenUsageRange = keyof typeof TOKEN_USAGE_RANGES

/** The dimensions the page offers to group by, in menu order. */
export const TOKEN_USAGE_GROUPS: readonly { value: UsageDimension; label: string }[] = [
  { value: 'model', label: t('Model') },
  { value: 'member', label: t('Member') },
  { value: 'runtime', label: t('Runtime') },
  { value: 'computer', label: t('Computer') },
  { value: 'trigger', label: t('Trigger') },
  // A Bot's row counts its Tasks too.
  { value: 'bot', label: t('Bot and its Tasks') },
  { value: 'task', label: t('Task') },
  { value: 'conversation', label: t('Conversation') },
  { value: 'source', label: t('Source') },
  { value: 'outcome', label: t('Outcome') },
]

export const usageGroupLabel = (dimension: UsageDimension): string =>
  TOKEN_USAGE_GROUPS.find((group) => group.value === dimension)?.label ?? dimension

/** The values each dimension is narrowed to, with the names they were picked by. */
export type UsageFilters = Partial<Record<UsageDimension, { value: string; label: string }[]>>

/** The filters as query parameters: each dimension's values, comma separated. */
export function filterQuery(
  filters: UsageFilters,
  except?: UsageDimension,
): Partial<Record<UsageDimension, string>> {
  return Object.fromEntries(
    Object.entries(filters).flatMap(([dimension, values]) =>
      dimension === except || values.length === 0
        ? []
        : [[dimension, values.map((value) => value.value).join(',')]],
    ),
  )
}

/** The filters with `value` added to or removed from `dimension`; an emptied one is dropped. */
export function toggleFilter(
  filters: UsageFilters,
  dimension: UsageDimension,
  value: { value: string; label: string },
): UsageFilters {
  const { [dimension]: current = [], ...rest } = filters
  const next = current.some((picked) => picked.value === value.value)
    ? current.filter((picked) => picked.value !== value.value)
    : [...current, value]

  return next.length ? { ...rest, [dimension]: next } : rest
}

/** The filters without `dimension`. */
export function clearFilter(filters: UsageFilters, dimension: UsageDimension): UsageFilters {
  const { [dimension]: _cleared, ...rest } = filters

  return rest
}

/** When runtime turns began recording cached tokens in input and cost (#3262 reached
 *  production); rows before it carry them only in the total, and are left as recorded. */
const CACHE_RECORDED_SINCE = '2026-11-17T14:24:20Z'

/** That moment in the viewer's own date and time format. */
export function usageCacheCutoff(): string {
  return new Date(CACHE_RECORDED_SINCE).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

/** The query window: whole local days ending tonight at midnight, so today is included. */
export function tokenUsageWindow(range: TokenUsageRange, now: Date): { from: string; to: string } {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const start = new Date(
    end.getFullYear(),
    end.getMonth(),
    end.getDate() - TOKEN_USAGE_RANGES[range].days,
  )

  return { from: start.toISOString(), to: end.toISOString() }
}

/** The same number of days just before `window`, to compare it with. */
export function previousTokenUsageWindow(window: { from: string; to: string }): {
  from: string
  to: string
} {
  const start = new Date(window.from)
  const days = Math.round((Date.parse(window.to) - start.getTime()) / 86_400_000)
  const before = new Date(start.getFullYear(), start.getMonth(), start.getDate() - days)

  return { from: before.toISOString(), to: window.from }
}

/** Names the page can show instead of ids; anything unknown shows as recorded. */
export type UsageNames = {
  runtimes: ReadonlyMap<string, string>
  /** What the backend named: people, conversation titles, Trigger names, computer labels. */
  served?: TeamUsageNames
}

export type TokenUsageLine = {
  key: string
  label: string
  inputTokens: number
  cachedInputTokens: number
  cacheWriteTokens: number
  outputTokens: number
  totalTokens: number
  /** The same group's total in the window before, 0 if it used nothing then. */
  previousTotalTokens: number
  costUsd?: number
}

/** One line per group, most tokens first, named where the page knows the id. */
export function tokenUsageLines(
  rows: readonly TeamUsageRow[],
  groupBy: UsageDimension,
  names: UsageNames,
  previous: readonly TeamUsageRow[] = [],
): TokenUsageLine[] {
  const before = new Map(previous.map((row) => [row.keys[groupBy] ?? '', row.totalTokens]))

  return rows
    .map((row) => {
      const value = row.keys[groupBy] ?? null

      return {
        key: value ?? '',
        label: usageLabel(value, groupBy, names),
        inputTokens: row.inputTokens,
        cachedInputTokens: row.cachedInputTokens,
        cacheWriteTokens: row.cacheWriteTokens,
        outputTokens: row.outputTokens,
        totalTokens: row.totalTokens,
        previousTotalTokens: before.get(value ?? '') ?? 0,
        ...(row.costUsd === undefined ? {} : { costUsd: row.costUsd }),
      }
    })
    .sort((a, b) => b.totalTokens - a.totalTokens || a.label.localeCompare(b.label))
}

/** The backend's one row for every conversation other members made private. */
export const OTHERS_PRIVATE = 'private:others'

/** A grouped value as the page shows it: the backend's name, a runtime's name, or the id. */
export function usageLabel(
  value: string | null,
  groupBy: UsageDimension,
  names: UsageNames,
): string {
  if (value === null && groupBy === 'bot') return t('Not in a Bot')
  if (value === null && groupBy === 'task') return t('Not in a Task')
  if (value === null) return t('Not recorded')
  if (value === OTHERS_PRIVATE) return t('Other members’ private conversations')

  const served = names.served?.[groupBy]?.[value]

  // A teammate's conversation the viewer may not name shows as plainly that, as team activity does.
  if (served === null) return groupBy === 'bot' ? t('Bot') : usageGroupLabel(groupBy)

  return served ?? (groupBy === 'runtime' ? names.runtimes.get(value) : undefined) ?? value
}

const SPLIT_TOP = 4

/** One series per largest group, the rest as Other, and a point for every day of the window. */
export function tokenUsageSplit(
  rows: readonly TeamUsageRow[],
  groupBy: UsageDimension,
  names: UsageNames,
  window: { from: string; to: string },
): { series: { key: string; label: string }[]; points: Record<string, number>[]; total: number } {
  const totals = new Map<string, number>()

  for (const row of rows) {
    const value = row.keys[groupBy] ?? ''

    totals.set(value, (totals.get(value) ?? 0) + row.totalTokens)
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1])
  const top = ranked.slice(0, SPLIT_TOP).map(([value]) => value)
  const seriesOf = (value: string) => {
    const index = top.indexOf(value)

    return index === -1 ? 'other' : `s${String(index)}`
  }
  const series = [
    ...top.map((value, index) => ({
      key: `s${String(index)}`,
      label: usageLabel(value === '' ? null : value, groupBy, names),
    })),
    ...(ranked.length > SPLIT_TOP ? [{ key: 'other', label: t('Other') }] : []),
  ]
  // Buckets start at local midnight; keying by local date keeps daylight-saving days aligned.
  const day = (at: Date) => at.toDateString()
  const byDay = new Map<string, Record<string, number>>()

  for (const row of rows) {
    if (!row.keys.time) continue
    const point = byDay.get(day(new Date(row.keys.time))) ?? {}
    const key = seriesOf(row.keys[groupBy] ?? '')

    point[key] = (point[key] ?? 0) + row.totalTokens
    byDay.set(day(new Date(row.keys.time)), point)
  }
  const start = new Date(window.from)
  // Rounded, since a daylight-saving day is an hour short or long.
  const count = Math.round((Date.parse(window.to) - start.getTime()) / 86_400_000)
  const points = Array.from({ length: count }, (_, index) => {
    const at = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index)
    const used = byDay.get(day(at)) ?? {}

    return {
      at: at.getTime(),
      ...Object.fromEntries(series.map(({ key }) => [key, used[key] ?? 0])),
    }
  })

  return { series, points, total: ranked.reduce((sum, [, value]) => sum + value, 0) }
}

/** 1234 → "1.2K", 3_400_000 → "3.4M". */
export function formatTokens(value: number): string {
  if (value < 1000) return String(value)
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)}K`
  if (value < 1_000_000_000) return `${(value / 1_000_000).toFixed(1)}M`

  return `${(value / 1_000_000_000).toFixed(1)}B`
}

/** How a group's total moved since the window before: "+120%", "−30%", or New. */
export function formatChange(line: TokenUsageLine): string {
  if (line.previousTotalTokens === 0) return line.totalTokens > 0 ? t('New') : '—'
  const percent = Math.round(
    ((line.totalTokens - line.previousTotalTokens) / line.previousTotalTokens) * 100,
  )

  if (percent > 0) return `+${String(percent)}%`
  if (percent < 0) return `−${String(-percent)}%`

  return '0%'
}

export function formatUsd(value: number): string {
  return value < 0.01 && value > 0 ? '<$0.01' : `$${value.toFixed(2)}`
}
