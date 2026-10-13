import type { DashboardPanel, NuphosDashboard } from './schema'

/** The current successful run wins, including while a refresh response is
 * arriving ahead of the next detail poll. Otherwise keep the last good output. */
export function panelDisplay(panel: DashboardPanel, range?: NuphosDashboard['timeRange']) {
  const snapshot =
    panel.currentSnapshot?.status === 'complete' && panel.currentSnapshot.output
      ? panel.currentSnapshot
      : panel.lastSuccessfulSnapshot
  const start = snapshot?.params.periodStart
  const end = snapshot?.params.periodEnd
  const staleRange =
    range &&
    typeof start === 'string' &&
    typeof end === 'string' &&
    (start !== range.periodStart || end !== range.periodEnd)

  return {
    snapshot,
    rangeLabel: staleRange
      ? `Data period ${start.slice(0, 10)} – ${end.slice(0, 10)} (UTC) · Awaiting update`
      : null,
  }
}
