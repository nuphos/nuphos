import { ExternalLink } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api } from '../../api'
import { Age } from '../../components/Age'
import { Table } from '../../components/Table'
import { useWorkspaceTab } from '../../hooks/useWorkspaceTab'
import { useLinkOnlyRowMenu } from '../../lib/workspaceRowLink'
import { useResetOnKey } from '../useResetOnKey'
import { useResourceList } from '../useResourceList'

import { ErrorBlock } from './ErrorBlock'
import { applyFilter } from './shared'

import type { CommonProps } from './shared'
import type { ResourceListLoader } from '../../lib/resourceListCache'
import type { AwsCfnStack } from '../../types'

export function CloudFormationView({
  loader,
  filter,
  refreshKey,
  onCount,
  onLoading,
  getRowLink,
}: CommonProps & {
  loader: ResourceListLoader<AwsCfnStack>
  getRowLink?: (stack: AwsCfnStack) => string
}) {
  const [openError, setOpenError] = useState<string | null>(null)
  const { pollTick } = useWorkspaceTab()
  const { items, loading, error } = useResourceList(loader, refreshKey, onLoading, { pollTick })

  useResetOnKey(`${error ?? ''}|${String(items.length)}`, () => {
    if (!error) setOpenError(null)
  })

  const filtered = applyFilter(
    items,
    filter,
    (s) =>
      `${s.stackName} ${s.status} ${s.region} ${s.description ?? ''} ${s.statusReason ?? ''} ${s.driftStatus ?? ''}`,
  )

  const statusCounts = filtered.reduce(
    (acc, stack) => {
      const status = stack.status

      if (status.endsWith('_FAILED') || status.includes('ROLLBACK')) acc.failed += 1
      else if (status.endsWith('_IN_PROGRESS')) acc.inProgress += 1
      else if (status.endsWith('_COMPLETE') && status !== 'DELETE_COMPLETE') acc.complete += 1
      else acc.other += 1

      return acc
    },
    { complete: 0, failed: 0, inProgress: 0, other: 0 },
  )

  useEffect(() => {
    onCount(filtered.length)
  }, [filtered.length, onCount])

  function openStack(stack: AwsCfnStack) {
    setOpenError(null)
    api.appOpenExternal(cloudFormationStackUrl(stack)).catch((err: unknown) => {
      setOpenError(String(err instanceof Error ? err.message : err))
    })
  }

  const { onRowContextMenu, menu: cfnMenu } = useLinkOnlyRowMenu(getRowLink)

  if (error) return <ErrorBlock message={error} />

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-zGray-850 bg-zGray-950 text-[12px]">
        <CloudFormationStat label="Complete" value={statusCounts.complete} tone="success" />
        <CloudFormationStat label="In progress" value={statusCounts.inProgress} tone="warning" />
        <CloudFormationStat label="Failed" value={statusCounts.failed} tone="error" />
        {statusCounts.other > 0 && (
          <CloudFormationStat label="Other" value={statusCounts.other} tone="muted" />
        )}
        {openError && <span className="ml-auto text-error">{openError}</span>}
      </div>
      {cfnMenu}
      <Table<AwsCfnStack>
        loading={loading}
        rows={filtered}
        rowKey={(r) => r.stackId}
        onPrimaryAction={openStack}
        onRowContextMenu={onRowContextMenu}
        storageKey="aws.cfn-stacks"
        defaultSort={{ key: 'updated', dir: 'desc' }}
        empty="No CloudFormation stacks"
        columns={[
          {
            key: 'stackName',
            header: 'Stack Name',
            width: 260,
            sortAccessor: (r) => r.stackName,
            render: (r) => (
              <span className="text-zViolet-accent truncate block" title={r.stackName}>
                {r.stackName}
              </span>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            width: 200,
            sortAccessor: (r) => r.status,
            render: (r) => {
              const s = r.status
              let cls = 'text-secondary'

              if (s.endsWith('_COMPLETE') && !s.includes('ROLLBACK') && s !== 'DELETE_COMPLETE') {
                cls = 'text-[#73bf69]'
              } else if (s.endsWith('_FAILED') || s.includes('ROLLBACK')) {
                cls = 'text-error'
              } else if (s.endsWith('_IN_PROGRESS')) {
                cls = 'text-amber-400'
              }

              return <span className={cls}>{s}</span>
            },
          },
          {
            key: 'region',
            header: 'Region',
            width: 130,
            sortAccessor: (r) => r.region,
            render: (r) => <span className="text-secondary">{r.region}</span>,
          },
          {
            key: 'statusReason',
            header: 'Status Reason',
            width: 260,
            sortAccessor: (r) => r.statusReason ?? '',
            render: (r) => (
              <span
                className="text-secondary truncate block max-w-[240px]"
                title={r.statusReason ?? undefined}
              >
                {r.statusReason ?? '—'}
              </span>
            ),
          },
          {
            key: 'description',
            header: 'Template',
            width: 240,
            sortAccessor: (r) => r.description ?? '',
            render: (r) => (
              <span
                className="text-secondary truncate block max-w-[220px]"
                title={r.description ?? undefined}
              >
                {r.description ?? '—'}
              </span>
            ),
          },
          {
            key: 'driftStatus',
            header: 'Drift',
            width: 110,
            sortAccessor: (r) => r.driftStatus ?? '',
            render: (r) => <span className="text-secondary">{r.driftStatus ?? '—'}</span>,
          },
          {
            key: 'updated',
            header: 'Updated',
            width: 100,
            sortAccessor: (r) => r.updatedAt ?? r.createdAt,
            render: (r) => (
              <span className="text-tertiary">
                <Age value={r.updatedAt ?? r.createdAt} />
              </span>
            ),
          },
          {
            key: 'created',
            header: 'Created',
            width: 100,
            sortAccessor: (r) => r.createdAt,
            render: (r) => (
              <span className="text-tertiary">
                <Age value={r.createdAt} />
              </span>
            ),
          },
          {
            key: 'actions',
            header: '',
            width: 48,
            render: (r) => (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  openStack(r)
                }}
                className="w-6 h-6 rounded text-tertiary hover:bg-zGray-800 hover:text-main flex items-center justify-center"
                title="Open stack in AWS Console"
              >
                <ExternalLink className="w-3.5 h-3.5" strokeWidth={1.8} />
              </button>
            ),
          },
        ]}
      />
    </>
  )
}

function cloudFormationStackUrl(stack: AwsCfnStack): string {
  const params = new URLSearchParams({ region: stack.region })

  return `https://${stack.region}.console.aws.amazon.com/cloudformation/home?${params.toString()}#/stacks/stackinfo?stackId=${encodeURIComponent(stack.stackId)}`
}

function CloudFormationStat({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'success' | 'warning' | 'error' | 'muted'
}) {
  const cls =
    tone === 'success'
      ? 'text-success'
      : tone === 'warning'
        ? 'text-amber-400'
        : tone === 'error'
          ? 'text-error'
          : 'text-tertiary'

  return (
    <span className="inline-flex items-center gap-1.5 text-secondary">
      <span className={cls}>{value}</span>
      <span>{label}</span>
    </span>
  )
}
