import { useEffect } from 'react'

import { Age } from '../../components/Age'
import { StatusBadge } from '../../components/StatusBadge'
import { Table } from '../../components/Table'
import { useReportLoading } from '../../components/useReportLoading'
import { t } from '../../i18n'

import { ErrorBlock } from './ErrorBlock'
import { applyFilter, useLoader } from './shared'

import type { CommonProps } from './shared'
import type { AwsEcsContainerInstance } from '../../types'

export function EcsInfrastructureView({
  loader,
  capacityProviders,
  filter,
  refreshKey,
  onCount,
  onLoading,
}: CommonProps & {
  loader: () => Promise<AwsEcsContainerInstance[]>
  capacityProviders: string[]
}) {
  const { items, loading, error } = useLoader<AwsEcsContainerInstance[]>(loader, [refreshKey], [])

  useReportLoading(loading, onLoading)

  const filtered = applyFilter(
    items,
    filter,
    (c) => `${c.ec2InstanceId} ${c.status} ${c.capacityProviderName ?? ''}`,
  )

  useEffect(() => {
    onCount(filtered.length)
  }, [filtered.length, onCount])

  if (error) return <ErrorBlock message={error} />

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-4 py-3 border-b border-zGray-850 bg-zGray-950">
        <div className="text-[11px] uppercase tracking-wide text-tertiary mb-1.5">
          {t('Capacity providers')}
        </div>
        {capacityProviders.length === 0 ? (
          <div className="text-[12.5px] text-tertiary">{t('None configured')}</div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {capacityProviders.map((cp) => (
              <span
                key={cp}
                className="inline-flex items-center h-6 px-2 rounded bg-zGray-850 text-[12px] text-secondary font-mono"
              >
                {cp}
              </span>
            ))}
          </div>
        )}
      </div>
      <Table<AwsEcsContainerInstance>
        loading={loading}
        rows={filtered}
        rowKey={(r) => r.containerInstanceArn}
        storageKey="aws.ecs-container-instances"
        defaultSort={{ key: 'ec2InstanceId', dir: 'asc' }}
        empty={t("No container instances (Fargate-only clusters won't have any)")}
        columns={[
          {
            key: 'ec2InstanceId',
            header: t('EC2 Instance'),
            width: 200,
            sortAccessor: (r) => r.ec2InstanceId,
            render: (r) => (
              <span className="font-mono text-[11.5px] text-zViolet-accent">{r.ec2InstanceId}</span>
            ),
          },
          {
            key: 'status',
            header: t('Status'),
            width: 100,
            sortAccessor: (r) => r.status,
            render: (r) => <StatusBadge status={r.status} />,
          },
          {
            key: 'agent',
            header: t('Agent'),
            width: 90,
            sortAccessor: (r) => (r.agentConnected ? 1 : 0),
            render: (r) =>
              r.agentConnected ? (
                <span className="text-success">{t('Connected')}</span>
              ) : (
                <span className="text-error">{t('Disconnected')}</span>
              ),
          },
          {
            key: 'running',
            header: t('Running'),
            width: 90,
            sortAccessor: (r) => r.runningTasksCount,
            render: (r) => <span className="text-secondary">{r.runningTasksCount}</span>,
          },
          {
            key: 'pending',
            header: t('Pending|tasks'),
            width: 90,
            sortAccessor: (r) => r.pendingTasksCount,
            render: (r) => <span className="text-secondary">{r.pendingTasksCount}</span>,
          },
          {
            key: 'cpu',
            header: t('CPU (free/total)'),
            width: 140,
            sortAccessor: (r) => r.cpuRemaining ?? 0,
            render: (r) => (
              <span className="text-secondary font-mono text-[11.5px]">
                {r.cpuRemaining ?? '—'} / {r.cpuRegistered ?? '—'}
              </span>
            ),
          },
          {
            key: 'memory',
            header: t('Mem MiB (free/total)'),
            width: 170,
            sortAccessor: (r) => r.memoryRemaining ?? 0,
            render: (r) => (
              <span className="text-secondary font-mono text-[11.5px]">
                {r.memoryRemaining ?? '—'} / {r.memoryRegistered ?? '—'}
              </span>
            ),
          },
          {
            key: 'capacityProvider',
            header: t('Capacity Provider'),
            width: 200,
            sortAccessor: (r) => r.capacityProviderName ?? '',
            render: (r) => (
              <span className="text-secondary text-[11.5px]">{r.capacityProviderName || '—'}</span>
            ),
          },
          {
            key: 'agentVersion',
            header: t('Agent / Docker'),
            width: 180,
            sortAccessor: (r) => r.agentVersion ?? '',
            render: (r) => (
              <span className="text-secondary font-mono text-[11.5px]">
                {r.agentVersion ?? '—'}
                {r.dockerVersion ? ` · ${r.dockerVersion}` : ''}
              </span>
            ),
          },
          {
            key: 'registered',
            header: t('Registered'),
            width: 100,
            sortAccessor: (r) => r.registeredAt ?? '',
            render: (r) => (
              <span className="text-tertiary">
                <Age value={r.registeredAt} />
              </span>
            ),
          },
        ]}
      />
    </div>
  )
}
