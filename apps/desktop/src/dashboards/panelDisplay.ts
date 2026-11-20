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

/** "Not connected: <integration>" when the panel's last run found an integration gone; the
 *  error log keeps the full diagnostic, and every other failure stays behind the log. */
export function panelNotConnected(snapshot: DashboardPanel['currentSnapshot']): string | null {
  if (snapshot?.status !== 'failed' || snapshot.error?.kind !== 'not_connected') return null

  return snapshot.error.message.split('\n', 1)[0] || null
}
