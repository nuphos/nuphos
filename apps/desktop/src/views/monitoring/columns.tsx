import { CloudLogo } from '../../components/CloudLogo'
import { PROVIDER_LABEL } from '../../lib/monitoringWatch'

import { StatusBadge } from './parts'
import { formatRelative } from './rowActions'

import type { Column } from '../../components/Table'
import type { MonitoringOverviewRow } from '../../types'

/**
 * Data only. Copy link, Watch and the rest are row *actions*, and they live in
 * the row menu — reachable from the trailing "⋯" or a right-click anywhere in
 * the row, the same as every other table here. Repeating the two most common
 * ones as pinned buttons cost ~84px of permanently pinned width to save a
 * single click, and made this the one table with a bespoke actions column.
 */
export function buildMonitoringColumns(): Column<MonitoringOverviewRow>[] {
  return [
    {
      key: 'name',
      header: 'Name',
      // Ahead of Status and pinned: Target alone is 320px, so an unpinned name
      // scrolls away long before the columns people come here to read. Status
      // stays right beside it, which is how the pair was meant to be scanned.
      width: 240,
      pin: 'left',
      sortAccessor: (r) => r.name,
      render: (r) => <span className="text-main truncate">{r.name}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      width: 110,
      sortAccessor: (r) => r.status,
      render: (r) => <StatusBadge status={r.status} label={r.statusLabel} />,
    },
    {
      key: 'provider',
      header: 'Provider',
      width: 170,
      sortAccessor: (r) => `${r.provider}:${r.integrationLabel}`,
      render: (r) => (
        <span
          className="inline-flex items-center gap-1.5 text-[11.5px] text-secondary"
          title={PROVIDER_LABEL[r.provider]}
        >
          <CloudLogo provider={r.provider} size={14} />
          <span className="truncate text-tertiary">{r.integrationLabel}</span>
        </span>
      ),
    },
    {
      key: 'kind',
      header: 'Kind',
      width: 100,
      sortAccessor: (r) => r.kind,
      render: (r) => <span className="text-secondary text-[11.5px]">{r.kind}</span>,
    },
    {
      key: 'target',
      header: 'Target',
      width: 320,
      sortAccessor: (r) => r.target ?? '',
      render: (r) => (
        <span
          className="text-secondary font-mono text-[11.5px] truncate"
          title={r.target ?? undefined}
        >
          {r.target ?? '—'}
        </span>
      ),
    },
    {
      key: 'lastIncident',
      header: 'Last incident',
      width: 140,
      sortAccessor: (r) => r.lastIncidentAt ?? '',
      render: (r) => (
        <span className="text-tertiary text-[11.5px]">{formatRelative(r.lastIncidentAt)}</span>
      ),
    },
  ]
}
