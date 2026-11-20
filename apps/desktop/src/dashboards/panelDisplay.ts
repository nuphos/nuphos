import { t } from '../i18n/index.ts'

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

// The failures a card states itself, by the first line of their message.
const STATED = new Set(['not_connected', 'no_runtime'])

/** "Not connected: <integration>" when the panel's last run found an integration gone, or why
 *  no agent could run it; the error log keeps the full diagnostic, and every other failure
 *  stays behind the log. */
export function panelNotice(snapshot: DashboardPanel['currentSnapshot']): string | null {
  if (snapshot?.status !== 'failed' || !STATED.has(snapshot.error?.kind ?? '')) return null

  return snapshot.error?.message.split('\n', 1)[0] || null
}

/**
 * What a card says when no agent could run its panel (#4168), and whether it offers a computer
 * from Nuphos: only to someone who may rent one. Everyone else reads the backend's `message`,
 * which says to ask a team admin.
 */
export function noAgentNotice(message: string, mayRent: boolean) {
  return mayRent
    ? {
        text: t(
          "Agents on your own computer can't run dashboard panels. A team agent or a computer from Nuphos can. Rent one, then refresh.",
        ),
        offerComputer: true,
      }
    : { text: message, offerComputer: false }
}
