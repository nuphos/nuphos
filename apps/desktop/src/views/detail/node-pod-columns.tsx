import { PodStatus, ReadyCount } from '../../components/K8sHealth'
import { UsageBar } from '../../components/UsageBar'
import { formatCpu, formatMemory } from '../../utils'

import type { Column } from '../../components/Table'
import type { PodItem } from '../../types'

export const NODE_POD_COLUMNS: Column<PodItem>[] = [
  {
    key: 'namespace',
    header: 'Namespace',
    width: 170,
    sortAccessor: (r) => r.namespace,
    render: (r) => <span className="text-secondary">{r.namespace}</span>,
  },
  {
    key: 'name',
    header: 'Name',
    width: 280,
    sortAccessor: (r) => r.name,
    render: (r) => <span className="text-zViolet-accent">{r.name}</span>,
  },
  {
    key: 'ready',
    header: 'Ready',
    width: 70,
    sortAccessor: (r) => parseInt(r.ready.split('/')[0] ?? '0', 10),
    render: (r) => <ReadyCount value={r.ready} status={r.status} />,
  },
  {
    key: 'status',
    header: 'Status',
    width: 130,
    sortAccessor: (r) => r.status,
    render: (r) => <PodStatus status={r.status} ready={r.ready} />,
  },
  {
    key: 'cpu',
    header: 'CPU',
    width: 150,
    sortAccessor: (r) => r.cpu,
    render: (r) => (
      <UsageBar used={r.cpu} requested={r.cpu_request} capacity={r.cpu_limit} format={formatCpu} />
    ),
  },
  {
    key: 'memory',
    header: 'Memory',
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
    key: 'restarts',
    header: 'Restarts',
    width: 90,
    sortAccessor: (r) => r.restarts,
    render: (r) => <span className={r.restarts > 0 ? 'text-warning' : ''}>{r.restarts}</span>,
  },
]
