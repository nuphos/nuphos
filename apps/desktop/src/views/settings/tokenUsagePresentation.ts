import { t } from '../../i18n/index.ts'

import type { TeamUsageRow, UsageDimension } from '../../types/usage'

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
  { value: 'source', label: t('Source') },
  { value: 'outcome', label: t('Outcome') },
]

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

/** Names the page can show instead of ids; anything unknown shows as recorded. */
export type UsageNames = {
  members: ReadonlyMap<string, string>
  runtimes: ReadonlyMap<string, string>
}

export type TokenUsageLine = {
  key: string
  label: string
  inputTokens: number
  cachedInputTokens: number
  cacheWriteTokens: number
  outputTokens: number
  totalTokens: number
  costUsd?: number
}

/** One line per group, most tokens first, named where the page knows the id. */
export function tokenUsageLines(
  rows: readonly TeamUsageRow[],
  groupBy: UsageDimension,
  names: UsageNames,
): TokenUsageLine[] {
  return rows
    .map((row) => {
      const value = row.keys[groupBy] ?? null
      const known = value === null ? undefined : namesFor(groupBy, names)?.get(value)

      return {
        key: value ?? '',
        label: value === null ? t('Not recorded') : (known ?? value),
        inputTokens: row.inputTokens,
        cachedInputTokens: row.cachedInputTokens,
        cacheWriteTokens: row.cacheWriteTokens,
        outputTokens: row.outputTokens,
        totalTokens: row.totalTokens,
        ...(row.costUsd === undefined ? {} : { costUsd: row.costUsd }),
      }
    })
    .sort((a, b) => b.totalTokens - a.totalTokens || a.label.localeCompare(b.label))
}

function namesFor(groupBy: UsageDimension, names: UsageNames) {
  if (groupBy === 'member') return names.members
  if (groupBy === 'runtime') return names.runtimes

  return null
}

/** The window's total tokens per day, a point for every day, zero where nothing was used. */
export function tokenUsageDays(
  rows: readonly TeamUsageRow[],
  window: { from: string; to: string },
): { at: number; value: number }[] {
  // Buckets start at local midnight; keying by local date keeps daylight-saving days aligned.
  const day = (at: Date) => at.toDateString()
  const byDay = new Map(
    rows.flatMap((row) =>
      row.keys.time ? [[day(new Date(row.keys.time)), row.totalTokens] as const] : [],
    ),
  )
  const start = new Date(window.from)
  // Rounded, since a daylight-saving day is an hour short or long.
  const count = Math.round((Date.parse(window.to) - start.getTime()) / 86_400_000)

  return Array.from({ length: count }, (_, index) => {
    const at = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index)

    return { at: at.getTime(), value: byDay.get(day(at)) ?? 0 }
  })
}

/** 1234 → "1.2K", 3_400_000 → "3.4M". */
export function formatTokens(value: number): string {
  if (value < 1000) return String(value)
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)}K`
  if (value < 1_000_000_000) return `${(value / 1_000_000).toFixed(1)}M`

  return `${(value / 1_000_000_000).toFixed(1)}B`
}

export function formatUsd(value: number): string {
  return value < 0.01 && value > 0 ? '<$0.01' : `$${value.toFixed(2)}`
}
