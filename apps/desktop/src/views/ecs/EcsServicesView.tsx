import { useEffect } from 'react'

import { Age } from '../../components/Age'
import { StatusBadge } from '../../components/StatusBadge'
import { Table } from '../../components/Table'
import { useReportLoading } from '../../components/useReportLoading'

import { ErrorBlock } from './ErrorBlock'
import { applyFilter, useLoader } from './shared'

import type { CommonProps } from './shared'
import type { AwsEcsService } from '../../types'

function shortTaskDef(arn: string): string {
  const slash = arn.lastIndexOf('/')

  return slash >= 0 ? arn.slice(slash + 1) : arn
}

export function EcsServicesView({
  loader,
  filter,
  refreshKey,
  onCount,
  onLoading,
}: CommonProps & {
  loader: () => Promise<AwsEcsService[]>
}) {
  const { items, loading, error } = useLoader<AwsEcsService[]>(loader, [refreshKey], [])

  useReportLoading(loading, onLoading)

  const filtered = applyFilter(
    items,
    filter,
    (s) => `${s.serviceName} ${s.status} ${s.launchType ?? ''} ${s.taskDefinition}`,
  )

  useEffect(() => {
    onCount(filtered.length)
  }, [filtered.length, onCount])

  if (error) return <ErrorBlock message={error} />

  return (
    <Table<AwsEcsService>
      loading={loading}
      rows={filtered}
      rowKey={(r) => r.serviceArn}
      storageKey="aws.ecs-services"
      defaultSort={{ key: 'serviceName', dir: 'asc' }}
      empty="No ECS services"
      columns={[
        {
          key: 'serviceName',
          header: 'Service Name',
          width: 280,
          sortAccessor: (r) => r.serviceName,
          render: (r) => <span className="font-medium text-zViolet-accent">{r.serviceName}</span>,
        },
        {
          key: 'status',
          header: 'Status',
          width: 100,
          sortAccessor: (r) => r.status,
          render: (r) => <StatusBadge status={r.status} />,
        },
        {
          key: 'desired',
          header: 'Desired',
          width: 80,
          sortAccessor: (r) => r.desiredCount,
          render: (r) => <span className="text-secondary">{r.desiredCount}</span>,
        },
        {
          key: 'running',
          header: 'Running',
          width: 80,
          sortAccessor: (r) => r.runningCount,
          render: (r) => (
            <span className={r.runningCount < r.desiredCount ? 'text-amber-400' : 'text-secondary'}>
              {r.runningCount}
            </span>
          ),
        },
        {
          key: 'pending',
          header: 'Pending',
          width: 80,
          sortAccessor: (r) => r.pendingCount,
          render: (r) => <span className="text-secondary">{r.pendingCount}</span>,
        },
        {
          key: 'launchType',
          header: 'Launch Type',
          width: 120,
          sortAccessor: (r) => r.launchType ?? '',
          render: (r) => <span className="text-secondary">{r.launchType || '—'}</span>,
        },
        {
          key: 'taskDefinition',
          header: 'Task Definition',
          width: 300,
          sortAccessor: (r) => r.taskDefinition,
          render: (r) => (
            <span
              className="font-mono text-[11.5px] text-secondary truncate block max-w-[280px]"
              title={r.taskDefinition}
            >
              {shortTaskDef(r.taskDefinition)}
            </span>
          ),
        },
        {
          key: 'scheduling',
          header: 'Scheduling',
          width: 110,
          sortAccessor: (r) => r.schedulingStrategy ?? '',
          render: (r) => <span className="text-secondary">{r.schedulingStrategy || '—'}</span>,
        },
        {
          key: 'age',
          header: 'Age',
          width: 100,
          sortAccessor: (r) => r.createdAt ?? '',
          render: (r) => (
            <span className="text-tertiary">
              <Age value={r.createdAt} />
            </span>
          ),
        },
      ]}
    />
  )
}
