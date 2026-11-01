import { Age } from '../components/Age'
import { K8sStatus as StatusBadge } from '../components/K8sHealth'
import { UsageBar } from '../components/UsageBar'
import { t } from '../i18n'
import { formatCpu, formatMemory } from '../utils'

import { CompactChipList } from './NodesViewChips'

import type { Column } from '../components/Table'
import type { NodeItem } from '../types'

export const nodeColumns: Column<NodeItem>[] = [
  {
    key: 'name',
    header: t('Name'),
    width: 280,
    sortAccessor: (r) => r.name,
    render: (r) => <span className="text-zViolet-accent">{r.name}</span>,
  },
  {
    key: 'status',
    header: t('Status'),
    width: 110,
    sortAccessor: (r) => r.status,
    render: (r) => (
      <span className="flex items-center gap-1.5">
        <StatusBadge status={r.status} />
        {!r.schedulable && (
          <span className="text-[10px] text-warning uppercase tracking-wider">{t('cordoned')}</span>
        )}
      </span>
    ),
  },
  {
    key: 'roles',
    header: t('Roles'),
    width: 140,
    sortAccessor: (r) => r.roles.join(','),
    render: (r) => <span className="text-secondary">{r.roles.join(', ') || '-'}</span>,
  },
  {
    key: 'pods',
    header: t('Pods'),
    width: 100,
    sortAccessor: (r) =>
      r.pods == null || r.pods_capacity == null || r.pods_capacity <= 0
        ? -1
        : r.pods / r.pods_capacity,
    render: (r) => (
      <span className="text-secondary tabular-nums">
        {r.pods == null ? '-' : r.pods}
        {r.pods_capacity != null && <span className="text-tertiary"> / {r.pods_capacity}</span>}
      </span>
    ),
  },
  {
    key: 'taints',
    header: t('Taints'),
    width: 210,
    sortAccessor: (r) => r.taints.length,
    render: (r) => <CompactChipList items={r.taints} kind="taint" />,
  },
  {
    key: 'conditions',
    header: t('Conditions'),
    width: 230,
    sortAccessor: (r) => r.conditions.join(','),
    render: (r) => <CompactChipList items={r.conditions} kind="condition" />,
  },
  {
    key: 'cpu',
    header: t('CPU'),
    width: 170,
    sortAccessor: (r) => r.cpu,
    render: (r) => (
      <UsageBar
        used={r.cpu}
        requested={r.cpu_request}
        capacity={r.cpu_capacity}
        format={formatCpu}
      />
    ),
  },
  {
    key: 'memory',
    header: t('Memory'),
    width: 180,
    sortAccessor: (r) => r.memory,
    render: (r) => (
      <UsageBar
        resource="memory"
        used={r.memory}
        requested={r.memory_request}
        capacity={r.memory_capacity}
        format={formatMemory}
      />
    ),
  },
  {
    key: 'version',
    header: t('Version'),
    width: 120,
    sortAccessor: (r) => r.version ?? '',
    render: (r) => <span className="text-secondary">{r.version || '-'}</span>,
  },
  {
    key: 'internal_ip',
    header: t('Internal IP'),
    width: 140,
    sortAccessor: (r) => r.internal_ip ?? '',
    render: (r) => (
      <span className="text-secondary font-mono text-[12px]">{r.internal_ip || '-'}</span>
    ),
  },
  {
    key: 'os',
    header: t('OS'),
    width: 220,
    sortAccessor: (r) => r.os_image ?? '',
    render: (r) => <span className="text-tertiary text-[12px]">{r.os_image || '-'}</span>,
  },
  {
    key: 'age',
    header: t('Age'),
    width: 100,
    sortAccessor: (r) => r.age ?? '',
    render: (r) => (
      <span className="text-tertiary">
        <Age value={r.age} />
      </span>
    ),
  },
]
