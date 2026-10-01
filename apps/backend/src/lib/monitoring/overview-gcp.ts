import { impersonateSa } from '@/lib/byos/gcp'

import { truncate } from './overview-types'

import type { MonitoringOverviewRow } from './overview-types'

// Alert policies + uptime checks via the Monitoring v3 REST API, authorized by
// impersonating the binding's service account (needs roles/monitoring.viewer).
// Live firing state comes from `projects.alerts.list` (state="OPEN") joined
// onto policies by resource name; when that call fails the rows degrade to the
// policy's enabled/disabled state instead of erroring the whole provider.
const GCP_MONITORING_BASE = 'https://monitoring.googleapis.com/v3'

export async function collectGcp(
  serviceAccountEmail: string,
  projectId: string,
  integrationId: string,
  teamId: string,
): Promise<MonitoringOverviewRow[]> {
  const impersonated = await impersonateSa(serviceAccountEmail, teamId)
  const { token } = await impersonated.getAccessToken()

  if (!token) throw new Error('Failed to obtain an impersonated GCP access token')

  const [policies, uptimeChecks, openAlerts] = await Promise.all([
    gcpList<RawAlertPolicy>(token, projectId, 'alertPolicies', 'alertPolicies'),
    gcpList<RawUptimeCheck>(token, projectId, 'uptimeCheckConfigs', 'uptimeCheckConfigs'),
    gcpList<RawAlert>(token, projectId, 'alerts', 'alerts', { filter: 'state="OPEN"' }).catch(
      () => null,
    ),
  ])

  // Latest open-alert time per policy resource name.
  const openByPolicy = new Map<string, string>()

  for (const a of openAlerts ?? []) {
    const policyName = a.policy?.name

    if (!policyName) continue
    const existing = openByPolicy.get(policyName)

    if (!existing || (a.openTime ?? '') > existing) {
      openByPolicy.set(policyName, a.openTime ?? existing ?? '')
    }
  }

  const rows: MonitoringOverviewRow[] = []

  for (const p of policies) {
    const policyId = (p.name ?? '').split('/').pop() ?? ''
    const conditions = p.conditions ?? []
    const target =
      conditions.length === 1
        ? (conditions[0]?.displayName ?? null)
        : conditions.length > 1
          ? `${String(conditions.length)} conditions`
          : null
    const enabled = p.enabled !== false
    const openTime = p.name ? openByPolicy.get(p.name) : undefined
    const firing = enabled && openTime !== undefined

    rows.push({
      provider: 'gcp',
      integrationId,
      integrationLabel: projectId,
      providerResourceId: p.name ?? policyId,
      kind: 'alert-policy',
      name: p.displayName || policyId,
      status: firing ? 'down' : enabled ? 'up' : 'paused',
      statusLabel: firing ? 'firing' : enabled ? 'enabled' : 'disabled',
      target: target ? truncate(target, 120) : null,
      lastIncidentAt: openTime || null,
      providerUrl: policyId
        ? `https://console.cloud.google.com/monitoring/alerting/policies/${encodeURIComponent(policyId)}?project=${encodeURIComponent(projectId)}`
        : `https://console.cloud.google.com/monitoring/alerting?project=${encodeURIComponent(projectId)}`,
    })
  }
  for (const u of uptimeChecks) {
    const checkId = (u.name ?? '').split('/').pop() ?? ''
    const host = u.monitoredResource?.labels?.host
    const path = u.httpCheck?.path
    const target = host ? `${host}${path && path !== '/' ? path : ''}` : null

    rows.push({
      provider: 'gcp',
      integrationId,
      integrationLabel: projectId,
      providerResourceId: u.name ?? checkId,
      kind: 'uptime-check',
      name: u.displayName || checkId,
      // The check's own on/off switch. Whether the probed target is passing
      // is an alert policy's job — a failing check fires its policy above.
      status: u.disabled ? 'paused' : 'up',
      statusLabel: u.disabled ? 'disabled' : 'active',
      target,
      lastIncidentAt: null,
      providerUrl: checkId
        ? `https://console.cloud.google.com/monitoring/uptime/${encodeURIComponent(checkId)}?project=${encodeURIComponent(projectId)}`
        : `https://console.cloud.google.com/monitoring/uptime?project=${encodeURIComponent(projectId)}`,
    })
  }

  return rows
}

type RawAlertPolicy = {
  name?: string
  displayName?: string
  enabled?: boolean
  conditions?: { displayName?: string }[]
}

type RawUptimeCheck = {
  name?: string
  displayName?: string
  disabled?: boolean
  monitoredResource?: { labels?: Record<string, string> }
  httpCheck?: { path?: string }
}

type RawAlert = {
  name?: string
  state?: string
  openTime?: string
  policy?: { name?: string; displayName?: string }
}

async function gcpList<T>(
  token: string,
  projectId: string,
  resource: string,
  itemsKey: string,
  extraParams?: Record<string, string>,
): Promise<T[]> {
  const items: T[] = []
  let pageToken: string | undefined

  do {
    const params = new URLSearchParams({ pageSize: '500', ...extraParams })

    if (pageToken) params.set('pageToken', pageToken)
    const res = await fetch(
      `${GCP_MONITORING_BASE}/projects/${encodeURIComponent(projectId)}/${resource}?${params.toString()}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
      },
    )

    if (!res.ok) {
      // 403 here almost always means the bound SA lacks
      // roles/monitoring.viewer on the project — say so instead of
      // surfacing a bare status code.
      if (res.status === 403) {
        throw new Error(
          `Cloud Monitoring returned 403 for ${projectId} — grant roles/monitoring.viewer to the bound service account`,
        )
      }
      throw new Error(`Cloud Monitoring ${resource} API returned HTTP ${String(res.status)}`)
    }
    const body = (await res.json()) as Record<string, unknown> & { nextPageToken?: string }

    items.push(...((body[itemsKey] as T[] | undefined) ?? []))
    pageToken = body.nextPageToken
  } while (pageToken)

  return items
}
