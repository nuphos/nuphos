import { t } from '../../../i18n/index.ts'

import type { AgentStats, AgentStatsScope, HomeMetricKind } from '../../../types/team.ts'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS

/** What one human workday stands for in the "human time" estimate. */
export const WORKDAY_HOURS = 8

export const SCOPES: { value: AgentStatsScope; label: string; long: string }[] = [
  { value: 'me', label: t('Me'), long: t('Just me') },
  { value: 'team', label: t('Team'), long: t('Whole team') },
]

const TITLES: Record<HomeMetricKind, string> = {
  'agent-time': t('Agent time'),
  sessions: t('Sessions and sub-agents'),
  'pull-requests': t('Pull requests shipped'),
  streak: t('Streak'),
  'longest-run': t('Longest run'),
  'runtime-mix': t('Runtime mix'),
}

/** A metric card's title, for the card itself, its picker and its drag grip. */
export const metricTitle = (kind: HomeMetricKind): string => TITLES[kind]

// A headline number and one line under it, so these are a row shorter than the rest.
const SHORT = new Set<HomeMetricKind>(['agent-time', 'streak', 'longest-run'])

/** A metric card's size on the 12 column home grid: half a row, as tall as its content. */
export function metricSize(kind: HomeMetricKind): { w: number; h: number } {
  return { w: 6, h: SHORT.has(kind) ? 3 : 4 }
}

const decimal = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })

/** One decimal under 10, whole numbers from there: 2.4, 9.9, 12. */
export function roundSensibly(n: number): number {
  return n < 10 ? Math.round(n * 10) / 10 : Math.round(n)
}

/** Turn time as a single number: "45 min", "3.2 h", "18 h". */
export function formatHours(ms: number): { value: string; unit: string } {
  if (ms < HOUR_MS) return { value: String(Math.round(ms / MINUTE_MS)), unit: t('min') }

  return { value: decimal.format(roundSensibly(ms / HOUR_MS)), unit: t('h') }
}

/** A single run's length: "45 min", "3 h 12 min". */
export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / MINUTE_MS)

  if (minutes < 60) return t('{n} min', { n: minutes })

  return t('{h} h {m} min', { h: Math.floor(minutes / 60), m: minutes % 60 })
}

/** Turn time as human workdays, the card's estimate of the labor it stands for. */
export function workdays(ms: number): string {
  const n = roundSensibly(ms / (WORKDAY_HOURS * HOUR_MS))

  return n === 1
    ? t('About 1 workday of human time')
    : t('About {n} workdays of human time', { n: decimal.format(n) })
}

/** Change from the period before, in whole percent; null when there is nothing to compare. */
export function changePercent(current: number, previous: number): number | null {
  if (previous === 0) return null

  return Math.round(((current - previous) / previous) * 100)
}

export const dayCount = (n: number) => (n === 1 ? t('1 day') : t('{n} days', { n }))

export const shortDateTime = (iso: string) =>
  new Date(iso).toLocaleString([], {
    weekday: 'short',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

/** Each runtime's share of turn time in whole percent, largest first, adding up to 100. */
export function runtimeShares(
  runtimes: AgentStats['runtimes'],
): (AgentStats['runtimes'][number] & { percent: number })[] {
  const total = runtimes.reduce((sum, r) => sum + r.agentMs, 0)

  if (total === 0) return []
  const shares = runtimes.map((r) => ({ ...r, percent: Math.floor((r.agentMs / total) * 100) }))
  // Hand the rounding leftovers to the largest shares, so the bar fills exactly.
  let left = 100 - shares.reduce((sum, r) => sum + r.percent, 0)

  for (const share of shares) {
    if (left <= 0) break
    share.percent++
    left--
  }

  return shares
}
