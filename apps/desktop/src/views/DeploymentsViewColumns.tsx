import { ReadyCount, ReplicaCount } from '../components/K8sHealth'
import { Age } from '../components/Age'
import { UsageBar } from '../components/UsageBar'
import { formatCpu, formatMemory } from '../utils'

import type { Column } from '../components/Table'
import type { DeploymentItem } from '../types'

export const deploymentColumns: Column<DeploymentItem>[] = [
  {
    key: 'namespace',
    header: 'Namespace',
    width: 160,
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
    width: 100,
    sortAccessor: (r) => parseInt(r.ready.split('/')[0] ?? '0', 10),
    render: (r) => <ReadyCount value={r.ready} />,
  },
  {
    key: 'up_to_date',
    header: 'Up-to-date',
    width: 110,
    sortAccessor: (r) => r.up_to_date,
    render: (r) => <ReplicaCount value={r.up_to_date} desired={Number(r.ready.split('/')[1])} />,
  },
  {
    key: 'available',
    header: 'Available',
    width: 110,
    sortAccessor: (r) => r.available,
    render: (r) => <ReplicaCount value={r.available} desired={Number(r.ready.split('/')[1])} />,
  },
  {
    key: 'cpu',
    header: 'CPU',
    width: 170,
    sortAccessor: (r) => r.cpu,
    render: (r) => (
      <UsageBar used={r.cpu} requested={r.cpu_request} capacity={r.cpu_limit} format={formatCpu} />
    ),
  },
  {
    key: 'memory',
    header: 'Memory',
    width: 180,
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
    key: 'age',
    header: 'Age',
    width: 100,
    sortAccessor: (r) => r.age ?? '',
    render: (r) => (
      <span className="text-tertiary">
        <Age value={r.age} />
      </span>
    ),
  },
]
