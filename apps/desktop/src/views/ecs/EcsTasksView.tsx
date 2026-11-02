import { useEffect, useState } from 'react'

import { Age } from '../../components/Age'
import { StatusBadge } from '../../components/StatusBadge'
import { Table } from '../../components/Table'
import { useReportLoading } from '../../components/useReportLoading'
import { t } from '../../i18n'

import { ErrorBlock } from './ErrorBlock'
import { applyFilter, useLoader } from './shared'

import type { CommonProps } from './shared'
import type { AwsEcsTask } from '../../types'

export function EcsTasksView({
  loader,
  filter,
  refreshKey,
  onCount,
  onLoading,
}: CommonProps & {
  loader: (desiredStatus: 'RUNNING' | 'STOPPED') => Promise<AwsEcsTask[]>
}) {
  const [desiredStatus, setDesiredStatus] = useState<'RUNNING' | 'STOPPED'>('RUNNING')
  const { items, loading, error } = useLoader<AwsEcsTask[]>(
    () => loader(desiredStatus),
    [refreshKey, desiredStatus],
    [],
  )

  useReportLoading(loading, onLoading)

  const filtered = applyFilter(
    items,
    filter,
    (task) =>
      `${task.taskId} ${task.taskDefinitionFamily} ${task.lastStatus} ${task.desiredStatus} ${task.group ?? ''} ${task.launchType ?? ''}`,
  )

  useEffect(() => {
    onCount(filtered.length)
  }, [filtered.length, onCount])

  if (error) return <ErrorBlock message={error} />

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-1.5 px-4 py-2 border-b border-zGray-850 bg-zGray-950 text-[12px]">
        <span className="text-tertiary mr-1">{t('Desired status')}</span>
        {(['RUNNING', 'STOPPED'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setDesiredStatus(s)}
            className={`h-7 px-2.5 rounded-md text-[12.5px] font-medium ${
              desiredStatus === s
                ? 'bg-zViolet-500/15 text-zViolet-accent'
                : 'bg-zGray-850 hover:bg-zGray-800 text-secondary hover:text-main'
            }`}
          >
            {s === 'RUNNING' ? t('Running') : t('Stopped')}
          </button>
        ))}
        <span className="ml-auto text-tertiary">{t('{n} tasks', { n: filtered.length })}</span>
      </div>
      <Table<AwsEcsTask>
        loading={loading}
        rows={filtered}
        rowKey={(r) => r.taskArn}
        storageKey="aws.ecs-tasks"
        defaultSort={{ key: 'startedAt', dir: 'desc' }}
        empty={desiredStatus === 'RUNNING' ? t('No running tasks') : t('No stopped tasks')}
        columns={[
          {
            key: 'taskId',
            header: t('Task ID'),
            width: 280,
            sortAccessor: (r) => r.taskId,
            render: (r) => (
              <span className="font-mono text-[11.5px] text-zViolet-accent">{r.taskId}</span>
            ),
          },
          {
            key: 'lastStatus',
            header: t('Last Status'),
            width: 110,
            sortAccessor: (r) => r.lastStatus,
            render: (r) => <StatusBadge status={r.lastStatus} />,
          },
          {
            key: 'desiredStatus',
            header: t('Desired'),
            width: 90,
            sortAccessor: (r) => r.desiredStatus,
            render: (r) => <span className="text-secondary">{r.desiredStatus}</span>,
          },
          {
            key: 'health',
            header: t('Health'),
            width: 90,
            sortAccessor: (r) => r.healthStatus ?? '',
            render: (r) => <span className="text-secondary">{r.healthStatus || '—'}</span>,
          },
          {
            key: 'family',
            header: t('Task Definition'),
            width: 260,
            sortAccessor: (r) => `${r.taskDefinitionFamily}:${String(r.taskDefinitionRevision)}`,
            render: (r) => (
              <span className="font-mono text-[11.5px] text-secondary">
                {r.taskDefinitionFamily}
                <span className="text-tertiary">:{r.taskDefinitionRevision}</span>
              </span>
            ),
          },
          {
            key: 'launchType',
            header: t('Launch'),
            width: 110,
            sortAccessor: (r) => r.launchType ?? '',
            render: (r) => <span className="text-secondary">{r.launchType || '—'}</span>,
          },
          {
            key: 'az',
            header: t('AZ'),
            width: 130,
            sortAccessor: (r) => r.availabilityZone ?? '',
            render: (r) => <span className="text-secondary">{r.availabilityZone || '—'}</span>,
          },
          {
            key: 'cpu',
            header: t('CPU'),
            width: 80,
            sortAccessor: (r) => Number(r.cpu) || 0,
            render: (r) => <span className="text-secondary">{r.cpu || '—'}</span>,
          },
          {
            key: 'memory',
            header: t('Memory'),
            width: 90,
            sortAccessor: (r) => Number(r.memory) || 0,
            render: (r) => <span className="text-secondary">{r.memory || '—'}</span>,
          },
          {
            key: 'startedAt',
            header: t('Started'),
            width: 100,
            sortAccessor: (r) => r.startedAt ?? '',
            render: (r) => (
              <span className="text-tertiary">
                <Age value={r.startedAt} />
              </span>
            ),
          },
          {
            key: 'stoppedAt',
            header: t('Stopped'),
            width: 100,
            sortAccessor: (r) => r.stoppedAt ?? '',
            render: (r) => (
              <span className="text-tertiary">
                {r.stoppedAt ? <Age value={r.stoppedAt} /> : '—'}
              </span>
            ),
          },
        ]}
      />
    </div>
  )
}
