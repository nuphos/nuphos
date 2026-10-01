import { truncate } from './overview-types'

import type { MonitoringOverviewRow } from './overview-types'

// Server-side equivalent of the Desktop's Grafana client: hit the
// Prometheus-compatible rules API with the instance's service-account
// token and flatten alerting rules.
export async function collectGrafana(
  grafanaUrl: string,
  saToken: string,
  integrationId: string,
  integrationLabel: string,
): Promise<MonitoringOverviewRow[]> {
  const base = grafanaUrl.replace(/\/$/, '')
  const res = await fetch(`${base}/api/prometheus/grafana/api/v1/rules?type=alert`, {
    headers: { Authorization: `Bearer ${saToken}` },
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) {
    throw new Error(`Grafana rules API returned HTTP ${String(res.status)}`)
  }
  type RawRules = {
    status?: string
    data?: {
      groups?: {
        name?: string
        file?: string
        rules?: {
          uid?: string
          name?: string
          query?: string
          state?: string
          type?: string
          alerts?: { state?: string; activeAt?: string }[]
        }[]
      }[]
    }
  }
  const raw = (await res.json()) as RawRules

  if (raw.status && raw.status !== 'success') {
    throw new Error(`Grafana rules API status: ${raw.status}`)
  }

  const rows: MonitoringOverviewRow[] = []

  for (const g of raw.data?.groups ?? []) {
    for (const r of g.rules ?? []) {
      if (r.type && r.type !== 'alerting') continue
      const uid = r.uid || `${g.file ?? ''}/${g.name ?? ''}/${r.name ?? ''}`
      // The most recent activeAt across firing instances doubles as
      // "last incident" for alert rules.
      let lastActive: string | null = null

      for (const a of r.alerts ?? []) {
        if (a.activeAt && (!lastActive || a.activeAt > lastActive)) lastActive = a.activeAt
      }
      rows.push({
        provider: 'grafana',
        integrationId,
        integrationLabel,
        providerResourceId: uid,
        kind: 'alert-rule',
        name: r.name ?? uid,
        status: normalizeGrafanaState(r.state),
        statusLabel: grafanaStateLabel(r.state),
        target: r.query ? truncate(r.query, 120) : null,
        lastIncidentAt: lastActive,
        providerUrl: r.uid ? `${base}/alerting/grafana/${r.uid}/view` : `${base}/alerting/list`,
      })
    }
  }

  return rows
}

// Grafana's own words — "firing", "normal", "pending", "nodata", "error".
function grafanaStateLabel(s: string | undefined): string {
  const v = (s ?? '').toLowerCase()

  if (v === 'alerting') return 'firing'
  if (v === 'inactive' || v === 'ok' || v === '') return 'normal'

  return v
}

function normalizeGrafanaState(s: string | undefined): MonitoringOverviewRow['status'] {
  switch ((s ?? '').toLowerCase()) {
    case 'firing':
    case 'alerting':
      return 'down'
    case 'pending':
      return 'pending'
    case 'inactive':
    case 'normal':
    case 'ok':
      return 'up'
    default:
      return 'unknown'
  }
}
