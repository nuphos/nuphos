import { Copy, Globe } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api } from '../../api'
import { Age } from '../../components/Age'
import { ContextMenu } from '../../components/ContextMenu'
import { Table } from '../../components/Table'
import { useWorkspaceTab } from '../../hooks/useWorkspaceTab'
import { useRowLinkActions } from '../../lib/workspaceRowLink'
import { useResourceList } from '../useResourceList'

import { CloudWatchAlarmDetailView } from './cloudwatch-alarm-detail'
import { alarmConditionLabel, cloudWatchAlarmUrl } from './cloudwatch-alarm-format'
import { ErrorBlock } from './ErrorBlock'
import { applyFilter } from './shared'

import type { CommonProps } from './shared'
import type { ContextMenuItem } from '../../components/ContextMenu'
import type { ResourceListLoader } from '../../lib/resourceListCache'
import type {
  AwsCloudWatchAlarm,
  AwsCloudWatchAlarmHistoryItem,
  AwsCloudWatchMetricData,
} from '../../types'

export function CloudWatchAlarmsView({
  loader,
  metricDataLoader,
  historyLoader,
  detail,
  setDetail,
  filter,
  refreshKey,
  onCount,
  onLoading,
  getRowLink,
}: CommonProps & {
  loader: ResourceListLoader<AwsCloudWatchAlarm>
  metricDataLoader?: (
    alarm: AwsCloudWatchAlarm,
    rangeMinutes: number,
  ) => Promise<AwsCloudWatchMetricData>
  historyLoader?: (alarm: AwsCloudWatchAlarm) => Promise<AwsCloudWatchAlarmHistoryItem[]>
  /** Drill-down selection, lifted to tab state so breadcrumbs/refresh own the chrome. */
  detail?: { name: string; region: string } | null
  setDetail?: (d: { name: string; region: string } | null) => void
  getRowLink?: (alarm: AwsCloudWatchAlarm) => string
}) {
  const [menu, setMenu] = useState<{ alarm: AwsCloudWatchAlarm; x: number; y: number } | null>(null)
  const [localDetail, setLocalDetail] = useState<{ name: string; region: string } | null>(null)
  const detailSel = detail !== undefined ? detail : localDetail
  const setDetailSel = setDetail ?? setLocalDetail
  const { pollTick } = useWorkspaceTab()
  // Alarms carry too much state (condition, dimensions, threshold…) to
  // reconstruct from a {name, region} ref, so the list stays enabled while a
  // detail is open — it both resolves the selection and keeps the alarm's
  // state fresh. The detail view keys its fetches off alarm.arn, so the new
  // item identities from background refreshes are harmless.
  const { items, loading, error } = useResourceList(loader, refreshKey, onLoading, { pollTick })
  const resolvedAlarm = detailSel
    ? (items.find((a) => a.name === detailSel.name && a.region === detailSel.region) ?? null)
    : null

  const linkActions = useRowLinkActions(getRowLink)

  function buildAlarmMenu(alarm: AwsCloudWatchAlarm): ContextMenuItem[] {
    const linkItems = linkActions(alarm)

    return [
      ...linkItems,
      ...(linkItems.length > 0 ? [{ key: 'sep0', separator: true } as const] : []),
      {
        key: 'copy-name',
        label: 'Copy alarm name',
        icon: Copy,
        onSelect: () => void navigator.clipboard.writeText(alarm.name),
      },
      {
        key: 'open-console',
        label: 'Open in AWS console',
        icon: Globe,
        onSelect: () => void api.appOpenExternal(cloudWatchAlarmUrl(alarm)),
      },
    ]
  }

  const filtered = applyFilter(
    items,
    filter,
    (a) => `${a.name} ${a.state} ${a.metricName ?? ''} ${a.namespace ?? ''} ${a.region}`,
  )

  useEffect(() => {
    if (!detailSel) onCount(filtered.length)
  }, [filtered.length, onCount, detailSel])

  if (detailSel) {
    if (!resolvedAlarm) {
      if (error) return <ErrorBlock message={error} />
      if (loading) {
        return (
          <div className="h-full flex items-center justify-center text-sm text-tertiary">
            Loading alarm...
          </div>
        )
      }

      return (
        <ErrorBlock message={`Alarm ${detailSel.name} was not found in ${detailSel.region}.`} />
      )
    }

    return (
      <CloudWatchAlarmDetailView
        alarm={resolvedAlarm}
        metricDataLoader={metricDataLoader}
        historyLoader={historyLoader}
        onCount={onCount}
        onLoading={onLoading}
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
          items={buildAlarmMenu(menu.alarm)}
          onClose={() => setMenu(null)}
        />
      )}
      <Table<AwsCloudWatchAlarm>
        loading={loading}
        rows={filtered}
        rowKey={(r) => r.arn}
        onPrimaryAction={(a) => setDetailSel({ name: a.name, region: a.region })}
        onRowContextMenu={(alarm, e) => setMenu({ alarm, x: e.clientX, y: e.clientY })}
        storageKey="aws.cloudwatch-alarms"
        defaultSort={{ key: 'state', dir: 'asc' }}
        empty="No CloudWatch alarms"
        columns={[
          {
            key: 'state',
            header: 'State',
            width: 150,
            sortAccessor: (r) =>
              r.state === 'ALARM' ? 0 : r.state === 'INSUFFICIENT_DATA' ? 1 : 2,
            render: (r) => {
              const cls =
                r.state === 'ALARM'
                  ? 'text-error'
                  : r.state === 'OK'
                    ? 'text-[#73bf69]'
                    : 'text-amber-400'

              return <span className={`font-medium ${cls}`}>{r.state}</span>
            },
          },
          {
            key: 'name',
            header: 'Name',
            width: 300,
            sortAccessor: (r) => r.name,
            render: (r) => (
              <span className="text-zViolet-accent truncate block" title={r.name}>
                {r.name}
              </span>
            ),
          },
          {
            key: 'condition',
            header: 'Condition',
            width: 280,
            sortAccessor: (r) => r.metricName ?? '',
            render: (r) => (
              <span
                className="font-mono text-[11.5px] text-secondary truncate block"
                title={alarmConditionLabel(r)}
              >
                {alarmConditionLabel(r)}
              </span>
            ),
          },
          {
            key: 'namespace',
            header: 'Namespace',
            width: 150,
            sortAccessor: (r) => r.namespace ?? '',
            render: (r) => <span className="text-secondary">{r.namespace ?? '—'}</span>,
          },
          {
            key: 'region',
            header: 'Region',
            width: 130,
            sortAccessor: (r) => r.region,
            render: (r) => <span className="text-secondary">{r.region}</span>,
          },
          {
            key: 'updated',
            header: 'State changed',
            width: 110,
            sortAccessor: (r) => r.stateUpdatedAt ?? '',
            render: (r) => (
              <span className="text-tertiary">
                <Age value={r.stateUpdatedAt} />
              </span>
            ),
          },
        ]}
      />
    </>
  )
}
