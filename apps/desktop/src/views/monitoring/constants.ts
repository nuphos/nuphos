import { t } from '../../i18n/index.ts'
import { monitoringWatchGroupMemberKey } from '../../lib/monitoringWatch'

import type { MonitoringOverviewRow } from '../../types'

export type StatusFilter = 'all' | MonitoringOverviewRow['status']
export type ProviderFilter = 'all' | MonitoringOverviewRow['provider']

export const POLL_INTERVAL_MS = 30_000

export function monitoringRowKey(row: MonitoringOverviewRow): string {
  return monitoringWatchGroupMemberKey(row)
}

export const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: t('All statuses') },
  { value: 'down', label: t('Down / Firing') },
  { value: 'pending', label: t('Pending') },
  { value: 'up', label: t('Up / Normal') },
  { value: 'paused', label: t('Paused') },
  { value: 'unknown', label: t('Unknown') },
]

export const PROVIDER_OPTIONS: { value: ProviderFilter; label: string }[] = [
  { value: 'all', label: t('All providers') },
  { value: 'betterstack', label: 'Better Stack' },
  { value: 'grafana', label: 'Grafana' },
  { value: 'gcp', label: 'GCP Cloud Monitoring' },
]

export function filterMonitoringRows(
  rows: MonitoringOverviewRow[],
  search: string,
  statusFilter: StatusFilter,
  providerFilter: ProviderFilter,
): MonitoringOverviewRow[] {
  const q = search.trim().toLowerCase()

  return rows.filter((r) => {
    if (statusFilter !== 'all' && r.status !== statusFilter) return false
    if (providerFilter !== 'all' && r.provider !== providerFilter) return false
    if (
      q &&
      !r.name.toLowerCase().includes(q) &&
      !(r.target ?? '').toLowerCase().includes(q) &&
      !r.integrationLabel.toLowerCase().includes(q) &&
      !r.providerResourceId.toLowerCase().includes(q)
    ) {
      return false
    }

    return true
  })
}
