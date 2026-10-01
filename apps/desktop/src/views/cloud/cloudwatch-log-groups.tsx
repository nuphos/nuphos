import { Copy, Globe, Pencil } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { api } from '../../api'
import { Age } from '../../components/Age'
import { ContextMenu } from '../../components/ContextMenu'
import { Table } from '../../components/Table'
import { toast } from '../../components/ui/toast'
import { useWorkspaceTab } from '../../hooks/useWorkspaceTab'
import { useRowLinkActions } from '../../lib/workspaceRowLink'
import { useResourceList } from '../useResourceList'

import { ErrorBlock } from './ErrorBlock'
import { LogGroupEventsView } from './log-group-events'
import { cloudWatchLogGroupUrl } from './log-helpers'
import { LogRetentionModal } from './log-retention-modal'
import { applyFilter, formatBytes } from './shared'

import type { CommonProps } from './shared'
import type { ContextMenuItem } from '../../components/ContextMenu'
import type { ResourceListLoader } from '../../lib/resourceListCache'
import type {
  AwsLogGroup,
  AwsLogGroupEvents,
  AwsLogSearchOptions,
  AwsLogSearchResult,
  AwsLogStreamListing,
} from '../../types'

export function CloudWatchLogGroupsView({
  loader,
  eventsLoader,
  searchLoader,
  streamsLoader,
  setRetention,
  detail,
  setDetail,
  filter,
  refreshKey,
  onCount,
  onLoading,
  getRowLink,
}: CommonProps & {
  loader: ResourceListLoader<AwsLogGroup>
  eventsLoader?: (group: AwsLogGroup) => Promise<AwsLogGroupEvents>
  searchLoader?: (group: AwsLogGroup, options: AwsLogSearchOptions) => Promise<AwsLogSearchResult>
  streamsLoader?: (group: AwsLogGroup, nextToken?: string) => Promise<AwsLogStreamListing>
  setRetention?: (group: AwsLogGroup, retentionDays: number | null) => Promise<void>
  /** Drill-down selection, lifted to tab state so breadcrumbs/refresh own the chrome. */
  detail?: { name: string; region: string } | null
  setDetail?: (d: { name: string; region: string } | null) => void
  getRowLink?: (group: AwsLogGroup) => string
}) {
  const [menu, setMenu] = useState<{ group: AwsLogGroup; x: number; y: number } | null>(null)
  const [localDetail, setLocalDetail] = useState<{ name: string; region: string } | null>(null)
  const detailSel = detail !== undefined ? detail : localDetail
  const setDetailSel = setDetail ?? setLocalDetail
  const [retentionTarget, setRetentionTarget] = useState<AwsLogGroup | null>(null)
  const [retentionValue, setRetentionValue] = useState('never')
  const [retentionSaving, setRetentionSaving] = useState(false)
  const { pollTick } = useWorkspaceTab()
  const inDetail = !!detailSel
  const { items, setItems, loading, error } = useResourceList(loader, refreshKey, onLoading, {
    enabled: !inDetail,
    pollTick,
  })

  const detailGroup = useMemo<AwsLogGroup | null>(() => {
    if (!detailSel) return null

    return (
      items.find((g) => g.name === detailSel.name && g.region === detailSel.region) ?? {
        name: detailSel.name,
        region: detailSel.region,
        arn: null,
        createdAt: null,
        retentionDays: null,
        storedBytes: null,
        logGroupClass: null,
      }
    )
  }, [items, detailSel])

  const linkActions = useRowLinkActions(getRowLink)

  function buildGroupMenu(group: AwsLogGroup): ContextMenuItem[] {
    const linkItems = linkActions(group)

    return [
      ...linkItems,
      ...(linkItems.length > 0 ? [{ key: 'sep0', separator: true } as const] : []),
      {
        key: 'copy-name',
        label: 'Copy log group name',
        icon: Copy,
        onSelect: () => void navigator.clipboard.writeText(group.name),
      },
      ...(setRetention
        ? [
            {
              key: 'set-retention',
              label: 'Set retention…',
              icon: Pencil,
              onSelect: () => {
                setRetentionValue(
                  group.retentionDays != null ? String(group.retentionDays) : 'never',
                )
                setRetentionTarget(group)
              },
            } satisfies ContextMenuItem,
          ]
        : []),
      {
        key: 'open-console',
        label: 'Open in AWS console',
        icon: Globe,
        onSelect: () => void api.appOpenExternal(cloudWatchLogGroupUrl(group)),
      },
    ]
  }

  const saveRetention = async () => {
    if (!setRetention || !retentionTarget) return
    const days = retentionValue === 'never' ? null : Number(retentionValue)

    setRetentionSaving(true)
    try {
      await setRetention(retentionTarget, days)
      setItems((prev) =>
        prev.map((g) =>
          g.name === retentionTarget.name && g.region === retentionTarget.region
            ? { ...g, retentionDays: days }
            : g,
        ),
      )
      setRetentionTarget(null)
    } catch (e) {
      toast.apiError('Could not update retention', e, {
        fallback: 'Check your connection and try again.',
      })
    } finally {
      setRetentionSaving(false)
    }
  }

  const filtered = applyFilter(items, filter, (g) => `${g.name} ${g.region}`)

  useEffect(() => {
    if (!inDetail) onCount(filtered.length)
  }, [filtered.length, onCount, inDetail])

  if (detailGroup && eventsLoader) {
    return (
      <LogGroupEventsView
        group={detailGroup}
        loadEvents={eventsLoader}
        searchEvents={searchLoader}
        listStreams={streamsLoader}
        onCount={onCount}
        onLoading={onLoading}
        filter={filter}
        refreshKey={refreshKey}
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
          items={buildGroupMenu(menu.group)}
          onClose={() => setMenu(null)}
        />
      )}
      {retentionTarget && (
        <LogRetentionModal
          group={retentionTarget}
          value={retentionValue}
          onValueChange={setRetentionValue}
          saving={retentionSaving}
          onCancel={() => setRetentionTarget(null)}
          onSave={() => void saveRetention()}
        />
      )}
      <Table<AwsLogGroup>
        loading={loading}
        rows={filtered}
        rowKey={(r) => `${r.region}:${r.name}`}
        onPrimaryAction={(g) =>
          eventsLoader ? setDetailSel({ name: g.name, region: g.region }) : undefined
        }
        onRowContextMenu={(group, e) => setMenu({ group, x: e.clientX, y: e.clientY })}
        storageKey="aws.log-groups"
        defaultSort={{ key: 'name', dir: 'asc' }}
        empty="No CloudWatch log groups"
        columns={[
          {
            key: 'name',
            header: 'Name',
            width: 380,
            sortAccessor: (r) => r.name,
            render: (r) => (
              <span
                className="text-zViolet-accent truncate block font-mono text-[12px]"
                title={r.name}
              >
                {r.name}
              </span>
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
            key: 'retention',
            header: 'Retention',
            width: 110,
            sortAccessor: (r) => r.retentionDays ?? Number.MAX_SAFE_INTEGER,
            render: (r) => (
              <span className="text-secondary">
                {r.retentionDays != null ? `${String(r.retentionDays)} days` : 'Never expire'}
              </span>
            ),
          },
          {
            key: 'stored',
            header: 'Stored',
            width: 100,
            sortAccessor: (r) => r.storedBytes ?? -1,
            render: (r) => (
              <span className="text-secondary tabular-nums">
                {r.storedBytes != null ? formatBytes(r.storedBytes) : '—'}
              </span>
            ),
          },
          {
            key: 'class',
            header: 'Class',
            width: 110,
            sortAccessor: (r) => r.logGroupClass ?? '',
            render: (r) => <span className="text-tertiary">{r.logGroupClass ?? '—'}</span>,
          },
          {
            key: 'created',
            header: 'Created',
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
    </>
  )
}
