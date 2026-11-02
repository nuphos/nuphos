import { Age } from '../components/Age'
import { PodStatus, ReadyCount } from '../components/K8sHealth'
import { UsageBar } from '../components/UsageBar'
import { t } from '../i18n'
import { formatCpu, formatMemory } from '../utils'

import type { Column } from '../components/Table'
import type { PodItem } from '../types'

export const podColumns: Column<PodItem>[] = [
  {
    key: 'namespace',
    header: t('Namespace'),
    width: 160,
    sortAccessor: (r) => r.namespace,
    render: (r) => <span className="text-secondary">{r.namespace}</span>,
  },
  {
    key: 'name',
    header: t('Name'),
    width: 280,
    sortAccessor: (r) => r.name,
    render: (r) => <span className="text-zViolet-accent">{r.name}</span>,
  },
  {
    key: 'ready',
    header: t('Ready'),
    width: 80,
    sortAccessor: (r) => parseInt(r.ready.split('/')[0] ?? '0', 10),
    render: (r) => <ReadyCount value={r.ready} status={r.status} />,
  },
  {
    key: 'status',
    header: t('Status'),
    width: 130,
    sortAccessor: (r) => r.status,
    render: (r) => <PodStatus status={r.status} ready={r.ready} />,
  },
  {
    key: 'restarts',
    header: t('Restarts'),
    width: 90,
    sortAccessor: (r) => r.restarts,
    render: (r) => <span className={r.restarts > 0 ? 'text-warning' : ''}>{r.restarts}</span>,
  },
  {
    key: 'cpu',
    header: t('CPU'),
    width: 150,
    sortAccessor: (r) => r.cpu,
    render: (r) => (
      <UsageBar used={r.cpu} requested={r.cpu_request} capacity={r.cpu_limit} format={formatCpu} />
    ),
  },
  {
    key: 'memory',
    header: t('Memory'),
    width: 160,
    sortAccessor: (r) => r.memory,
    render: (r) => (
      <UsageBar
        resource="memory"
        used={r.memory}
        requested={r.memory_request}
        capacity={r.memory_limit}
        format={formatMemory}
      />
    ),
  },
  {
    key: 'node',
    header: t('Node'),
    width: 220,
    sortAccessor: (r) => r.node ?? '',
    render: (r) => <span className="text-secondary text-[12px]">{r.node || '-'}</span>,
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

export function bulkRestartText(n: number): string {
  return n === 1
    ? t(
        'Restart {n} pod? Pods managed by a controller are recreated; standalone pods are deleted.',
        { n },
      )
    : t(
        'Restart {n} pods? Pods managed by a controller are recreated; standalone pods are deleted.',
        { n },
      )
}

export function bulkDeleteText(n: number): string {
  return n === 1
    ? t('Delete {n} pod? This is irreversible.', { n })
    : t('Delete {n} pods? This is irreversible.', { n })
}
