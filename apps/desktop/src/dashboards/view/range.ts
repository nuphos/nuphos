import type { DashboardViewRange } from '../schema'

/** Ignore malformed deep links rather than treating a half-range as a default. */
export function parseDashboardViewRange(query: URLSearchParams): DashboardViewRange | undefined {
  const preset = query.get('preset')
  const periodStart = query.get('periodStart')
  const periodEnd = query.get('periodEnd')

  if (preset && !periodStart && !periodEnd) {
    if (
      preset === 'last7' ||
      preset === 'last14' ||
      preset === 'last30' ||
      preset === 'thisMonth' ||
      preset === 'prevMonth'
    )
      return { preset }

    return undefined
  }
  const granularity = query.get('granularity') ?? 'day'

  if (
    preset ||
    !periodStart ||
    !periodEnd ||
    !Number.isFinite(Date.parse(periodStart)) ||
    !Number.isFinite(Date.parse(periodEnd)) ||
    Date.parse(periodStart) >= Date.parse(periodEnd) ||
    (granularity !== 'day' && granularity !== 'week' && granularity !== 'month')
  )
    return undefined

  return {
    periodStart: new Date(periodStart).toISOString(),
    periodEnd: new Date(periodEnd).toISOString(),
    granularity,
  }
}
