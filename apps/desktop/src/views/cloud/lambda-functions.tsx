import { Copy, Globe } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { api } from '../../api'
import { Age } from '../../components/Age'
import { ContextMenu } from '../../components/ContextMenu'
import { Table } from '../../components/Table'
import { useWorkspaceTab } from '../../hooks/useWorkspaceTab'
import { useRowLinkActions } from '../../lib/workspaceRowLink'
import { useResourceList } from '../useResourceList'

import { ErrorBlock } from './ErrorBlock'
import { LambdaFunctionDetailView } from './lambda-detail'
import { lambdaConsoleUrl } from './lambda-helpers'
import { applyFilter, formatBytes } from './shared'

import type { CommonProps } from './shared'
import type { ContextMenuItem } from '../../components/ContextMenu'
import type { ResourceListLoader } from '../../lib/resourceListCache'
import type {
  AwsLambdaFunction,
  AwsLambdaFunctionDetail,
  AwsLambdaInvokeResult,
  AwsLambdaMetricsResponse,
  AwsLambdaTriggers,
  AwsLogGroup,
  AwsLogGroupEvents,
  AwsLogSearchOptions,
  AwsLogSearchResult,
  AwsLogStreamListing,
} from '../../types'

export function LambdaFunctionsView({
  loader,
  detailLoader,
  metricsLoader,
  eventsLoader,
  searchLoader,
  streamsLoader,
  invoker,
  configUpdater,
  triggersLoader,
  detail,
  setDetail,
  filter,
  refreshKey,
  onCount,
  onLoading,
  getRowLink,
}: CommonProps & {
  loader: ResourceListLoader<AwsLambdaFunction>
  detailLoader?: (fn: AwsLambdaFunction) => Promise<AwsLambdaFunctionDetail>
  metricsLoader?: (fn: AwsLambdaFunction, rangeMinutes: number) => Promise<AwsLambdaMetricsResponse>
  eventsLoader?: (group: AwsLogGroup) => Promise<AwsLogGroupEvents>
  searchLoader?: (group: AwsLogGroup, options: AwsLogSearchOptions) => Promise<AwsLogSearchResult>
  streamsLoader?: (group: AwsLogGroup, nextToken?: string) => Promise<AwsLogStreamListing>
  invoker?: (fn: AwsLambdaFunction, payload: string) => Promise<AwsLambdaInvokeResult>
  configUpdater?: (
    fn: AwsLambdaFunction,
    updates: { memoryMb?: number; timeoutSec?: number; environment?: Record<string, string> },
  ) => Promise<void>
  triggersLoader?: (fn: AwsLambdaFunction) => Promise<AwsLambdaTriggers>
  /** Drill-down selection, lifted to tab state so breadcrumbs/refresh own the chrome. */
  detail?: { name: string; region: string } | null
  setDetail?: (d: { name: string; region: string } | null) => void
  getRowLink?: (fn: AwsLambdaFunction) => string
}) {
  const [menu, setMenu] = useState<{ fn: AwsLambdaFunction; x: number; y: number } | null>(null)
  const [localDetail, setLocalDetail] = useState<{ name: string; region: string } | null>(null)
  const detailSel = detail !== undefined ? detail : localDetail
  const setDetailSel = setDetail ?? setLocalDetail
  const { pollTick } = useWorkspaceTab()
  const inDetail = !!detailSel && !!detailLoader
  const { items, loading, error } = useResourceList(loader, refreshKey, onLoading, {
    enabled: !inDetail,
    pollTick,
  })

  // Memoized so the fallback object doesn't get a fresh identity every render
  // (the detail view keys its fetches off this).
  const detailFn = useMemo<AwsLambdaFunction | null>(() => {
    if (!detailSel) return null

    return (
      items.find((f) => f.name === detailSel.name && f.region === detailSel.region) ?? {
        name: detailSel.name,
        region: detailSel.region,
        arn: '',
        runtime: null,
        handler: null,
        description: null,
        memoryMb: null,
        timeoutSec: null,
        codeSizeBytes: 0,
        packageType: null,
        architectures: [],
        lastModified: null,
      }
    )
  }, [items, detailSel])

  const linkActions = useRowLinkActions(getRowLink)

  function buildFunctionMenu(fn: AwsLambdaFunction): ContextMenuItem[] {
    const linkItems = linkActions(fn)

    return [
      ...linkItems,
      ...(linkItems.length > 0 ? [{ key: 'sep0', separator: true } as const] : []),
      {
        key: 'copy-arn',
        label: 'Copy ARN',
        icon: Copy,
        onSelect: () => void navigator.clipboard.writeText(fn.arn),
      },
      {
        key: 'open-console',
        label: 'Open in AWS console',
        icon: Globe,
        onSelect: () => void api.appOpenExternal(lambdaConsoleUrl(fn)),
      },
    ]
  }

  const filtered = applyFilter(items, filter, (f) => `${f.name} ${f.runtime ?? ''} ${f.region}`)

  useEffect(() => {
    if (!inDetail) onCount(filtered.length)
  }, [filtered.length, onCount, inDetail])

  if (detailFn && detailLoader) {
    return (
      <LambdaFunctionDetailView
        fn={detailFn}
        detailLoader={detailLoader}
        metricsLoader={metricsLoader}
        eventsLoader={eventsLoader}
        searchEvents={searchLoader}
        listStreams={streamsLoader}
        invoke={invoker}
        updateConfig={configUpdater}
        triggersLoader={triggersLoader}
        filter={filter}
        refreshKey={refreshKey}
        onCount={onCount}
        onLoading={onLoading}
      />
    )
  }

  if (error) return <ErrorBlock message={error} />

  return (
    <>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={buildFunctionMenu(menu.fn)}
          onClose={() => setMenu(null)}
        />
      )}
      <Table<AwsLambdaFunction>
        loading={loading}
        rows={filtered}
        rowKey={(r) => r.arn}
        onPrimaryAction={(f) => setDetailSel({ name: f.name, region: f.region })}
        onRowContextMenu={(fn, e) => setMenu({ fn, x: e.clientX, y: e.clientY })}
        storageKey="aws.lambda-functions"
        defaultSort={{ key: 'name', dir: 'asc' }}
        empty="No Lambda functions"
        columns={[
          {
            key: 'name',
            header: 'Name',
            width: 280,
            sortAccessor: (r) => r.name,
            render: (r) => (
              <span className="text-zViolet-accent truncate block" title={r.name}>
                {r.name}
              </span>
            ),
          },
          {
            key: 'runtime',
            header: 'Runtime',
            width: 130,
            sortAccessor: (r) => r.runtime ?? r.packageType ?? '',
            render: (r) => (
              <span className="font-mono text-[12px] text-secondary">
                {r.runtime ?? (r.packageType === 'Image' ? 'container' : '—')}
              </span>
            ),
          },
          {
            key: 'memory',
            header: 'Memory',
            width: 90,
            sortAccessor: (r) => r.memoryMb ?? 0,
            render: (r) => (
              <span className="text-secondary tabular-nums">
                {r.memoryMb != null ? `${String(r.memoryMb)} MB` : '—'}
              </span>
            ),
          },
          {
            key: 'timeout',
            header: 'Timeout',
            width: 90,
            sortAccessor: (r) => r.timeoutSec ?? 0,
            render: (r) => (
              <span className="text-secondary tabular-nums">
                {r.timeoutSec != null ? `${String(r.timeoutSec)} s` : '—'}
              </span>
            ),
          },
          {
            key: 'codeSize',
            header: 'Code size',
            width: 100,
            sortAccessor: (r) => r.codeSizeBytes,
            render: (r) => (
              <span className="text-secondary tabular-nums">{formatBytes(r.codeSizeBytes)}</span>
            ),
          },
          {
            key: 'region',
            header: 'Region',
            width: 140,
            sortAccessor: (r) => r.region,
            render: (r) => <span className="text-secondary">{r.region}</span>,
          },
          {
            key: 'modified',
            header: 'Modified',
            width: 100,
            sortAccessor: (r) => r.lastModified ?? '',
            render: (r) => (
              <span className="text-tertiary">
                <Age value={r.lastModified} />
              </span>
            ),
          },
        ]}
      />
    </>
  )
}
