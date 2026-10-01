export type MonitoringOverviewRow = {
  provider: 'betterstack' | 'grafana' | 'gcp'
  // Which binding the row came from — lets the UI group/filter and lets a
  // future detail call route back to the right credentials.
  integrationId: string
  integrationLabel: string
  providerResourceId: string
  kind: 'monitor' | 'heartbeat' | 'alert-rule' | 'alert-policy' | 'uptime-check'
  name: string
  // Normalized severity — used ONLY for sorting, filtering, and row color.
  // The user-visible word is `statusLabel`, which keeps each provider's
  // native vocabulary: a firing Grafana alert rule is "firing", not
  // "down" — alert rules describe conditions (cost exceeded, error rate),
  // not target liveness, so up/down would misread them.
  status: 'up' | 'down' | 'paused' | 'pending' | 'unknown'
  statusLabel: string
  // What is being checked: monitor URL, heartbeat cadence, or alert query.
  target: string | null
  lastIncidentAt: string | null
  // Deep link into the provider's own UI. Editing happens there, not here.
  providerUrl: string | null
}

export type MonitoringProviderError = {
  provider: 'betterstack' | 'grafana' | 'gcp'
  integrationId: string
  integrationLabel: string
  message: string
}

export type MonitoringOverview = {
  rows: MonitoringOverviewRow[]
  providerErrors: MonitoringProviderError[]
}

export function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}
