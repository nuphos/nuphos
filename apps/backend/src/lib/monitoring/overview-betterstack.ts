import {
  listBetterStackHeartbeats,
  listBetterStackIncidents,
  listBetterStackMonitors,
} from '@/lib/byos/betterstack'
import { decryptBetterStackToken } from '@/lib/byos/secrets'

import type { MonitoringOverviewRow } from './overview-types'

// Better Stack's web routes are team-scoped (/team/<id>/monitors/<id>) and
// the API exposes no team id, so per-resource deep links are impossible —
// teamless paths hard-404. Link to the dashboard root instead; it redirects
// a signed-in user to their default team.
const BS_DASHBOARD_URL = 'https://uptime.betterstack.com'

export async function collectBetterStack(
  encryptedToken: NonNullable<Parameters<typeof decryptBetterStackToken>[0]>,
  integrationId: string,
  integrationLabel: string,
  dashboardTeamId: string | undefined,
): Promise<MonitoringOverviewRow[]> {
  // With the user-supplied dashboard team id we can deep-link straight to
  // each monitor; without it the best non-404 target is the root.
  const monitorUrl = (id: string) =>
    dashboardTeamId
      ? `${BS_DASHBOARD_URL}/team/${dashboardTeamId}/monitors/${id}`
      : BS_DASHBOARD_URL
  const heartbeatUrl = (id: string) =>
    dashboardTeamId
      ? `${BS_DASHBOARD_URL}/team/${dashboardTeamId}/heartbeats/${id}`
      : BS_DASHBOARD_URL
  const uptimeApiToken = decryptBetterStackToken(encryptedToken)
  const handle = { uptimeApiToken }
  const [monitors, heartbeats, incidents] = await Promise.all([
    listBetterStackMonitors(handle),
    listBetterStackHeartbeats(handle),
    listBetterStackIncidents(handle).catch(() => []),
  ])

  // BS incidents carry the monitored URL, not the monitor id — join by URL
  // to find each monitor's most recent incident. Approximate but cheap,
  // and only used for the "last incident" column.
  const latestIncidentByUrl = new Map<string, string>()

  for (const inc of incidents) {
    if (!inc.url || !inc.startedAt) continue
    const existing = latestIncidentByUrl.get(inc.url)

    if (!existing || inc.startedAt > existing) {
      latestIncidentByUrl.set(inc.url, inc.startedAt)
    }
  }

  const rows: MonitoringOverviewRow[] = []

  for (const m of monitors) {
    rows.push({
      provider: 'betterstack',
      integrationId,
      integrationLabel,
      providerResourceId: m.id,
      kind: 'monitor',
      name: m.pronounceableName || m.url || `monitor ${m.id}`,
      status: normalizeBsStatus(m.status, m.pausedAt),
      statusLabel: bsStatusLabel(m.status, m.pausedAt),
      target: m.url,
      lastIncidentAt: m.url ? (latestIncidentByUrl.get(m.url) ?? null) : null,
      providerUrl: monitorUrl(m.id),
    })
  }
  for (const h of heartbeats) {
    rows.push({
      provider: 'betterstack',
      integrationId,
      integrationLabel,
      providerResourceId: h.id,
      kind: 'heartbeat',
      name: h.name || `heartbeat ${h.id}`,
      status: normalizeBsStatus(h.status, h.pausedAt),
      statusLabel: bsStatusLabel(h.status, h.pausedAt),
      target: h.period != null ? `every ${String(h.period)}s` : null,
      lastIncidentAt: null,
      providerUrl: heartbeatUrl(h.id),
    })
  }

  return rows
}

// Better Stack's own words — shown verbatim in the UI.
function bsStatusLabel(raw: string | null, pausedAt: string | null): string {
  if (pausedAt) return 'paused'

  return (raw ?? 'unknown').toLowerCase()
}

function normalizeBsStatus(
  raw: string | null,
  pausedAt: string | null,
): MonitoringOverviewRow['status'] {
  if (pausedAt) return 'paused'
  switch ((raw ?? '').toLowerCase()) {
    case 'up':
      return 'up'
    case 'down':
      return 'down'
    case 'paused':
      return 'paused'
    case 'pending':
    case 'validating':
      return 'pending'
    case 'maintenance':
      return 'paused'
    default:
      return 'unknown'
  }
}
