import type { MonitoringOverviewRow } from '../types'

function pathSegment(value: string): string {
  return encodeURIComponent(value)
}

export function monitoringItemPath(
  teamId: string,
  row: Pick<MonitoringOverviewRow, 'provider' | 'integrationId' | 'kind' | 'providerResourceId'>,
): string {
  return [
    '',
    'teams',
    pathSegment(teamId),
    'monitoring',
    pathSegment(row.provider),
    pathSegment(row.integrationId),
    pathSegment(row.kind),
    pathSegment(row.providerResourceId),
  ].join('/')
}
