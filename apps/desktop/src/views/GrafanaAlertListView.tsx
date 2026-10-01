import { AlertTriangle, CircleCheck, CircleSlash, Clock } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { Table } from '../components/Table'
import { listAlertRules } from '../grafana/client'
import { useSilentRefresh } from '../hooks/useSilentRefresh'
import { useWorkspaceTab } from '../hooks/useWorkspaceTab'
import { useLinkOnlyRowMenu, useWorkspaceRowLink } from '../lib/workspaceRowLink'

import { useResetOnKey } from './useResetOnKey'

import type { Column } from '../components/Table'
import type { AlertRuleSummary, AlertState, GrafanaTarget } from '../grafana/client'
import type { Bell } from 'lucide-react'

type Props = {
  target: GrafanaTarget
  filter?: string
  onCount?: (n: number) => void
}

export function GrafanaAlertListView({ target, filter, onCount }: Props) {
  const [items, setItems] = useState<AlertRuleSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useResetOnKey(`${target.teamId}|${target.instanceId}`, () => {
    setItems(null)
    setError(null)
  })

  useEffect(() => {
    let cancelled = false

    listAlertRules(target)
      .then((rows) => {
        if (!cancelled) setItems(rows)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(String(e instanceof Error ? e.message : e))
      })

    return () => {
      cancelled = true
    }
  }, [target.teamId, target.instanceId])

  const { pollTick } = useWorkspaceTab()

  useSilentRefresh(() => listAlertRules(target), pollTick, setItems, setError)

  const effectiveFilter = (filter ?? '').trim().toLowerCase()

  const filtered = useMemo(() => {
    const list = items ?? []

    if (!effectiveFilter) return list

    return list.filter(
      (r) =>
        r.name.toLowerCase().includes(effectiveFilter) ||
        r.folderTitle.toLowerCase().includes(effectiveFilter) ||
        r.groupName.toLowerCase().includes(effectiveFilter) ||
        Object.entries(r.labels).some(
          ([k, v]) =>
            k.toLowerCase().includes(effectiveFilter) || v.toLowerCase().includes(effectiveFilter),
        ),
    )
  }, [items, effectiveFilter])

  useEffect(() => {
    if (items === null) return
    onCount?.(filtered.length)
  }, [items, filtered.length, onCount])

  const { linkForRow } = useWorkspaceRowLink()
  const baseAlertsPath = `/teams/${encodeURIComponent(target.teamId)}/observability/grafana/${encodeURIComponent(target.instanceId)}/alerts`
  const getRowLink = useCallback(
    (r: AlertRuleSummary) => linkForRow({ path: `${baseAlertsPath}/${encodeURIComponent(r.uid)}` }),
    [linkForRow, baseAlertsPath],
  )
  const { onRowContextMenu, menu } = useLinkOnlyRowMenu(getRowLink)

  const summary = useMemo(() => {
    const list = items ?? []
    let firing = 0
    let pending = 0

    for (const r of list) {
      if (r.state === 'firing') firing += 1
      else if (r.state === 'pending') pending += 1
    }

    return { firing, pending, total: list.length }
  }, [items])

  const columns: Column<AlertRuleSummary>[] = [
    {
      key: 'state',
      header: 'State',
      width: 110,
      sortAccessor: (r) => stateRank(r.state),
      render: (r) => <StateBadge state={r.state} />,
    },
    {
      key: 'name',
      header: 'Name',
      width: 320,
      sortAccessor: (r) => r.name,
      render: (r) => <span className="text-main truncate">{r.name}</span>,
    },
    {
      key: 'instances',
      header: 'Active',
      width: 90,
      sortAccessor: (r) => firingInstanceCount(r),
      render: (r) => {
        const n = firingInstanceCount(r)

        return n > 0 ? (
          <span className="text-error font-mono text-[12px]">{n}</span>
        ) : (
          <span className="text-tertiary font-mono text-[12px]">0</span>
        )
      },
    },
    {
      key: 'folder',
      header: 'Folder',
      width: 220,
      sortAccessor: (r) => r.folderTitle,
      render: (r) => <span className="text-secondary truncate">{r.folderTitle || '—'}</span>,
    },
    {
      key: 'group',
      header: 'Group',
      width: 200,
      sortAccessor: (r) => r.groupName,
      render: (r) => <span className="text-tertiary truncate">{r.groupName}</span>,
    },
    {
      key: 'health',
      header: 'Health',
      width: 110,
      sortAccessor: (r) => r.health,
      render: (r) => (
        <span
          className={
            r.health === 'ok'
              ? 'text-secondary'
              : r.health === 'nodata'
                ? 'text-tertiary'
                : 'text-error'
          }
        >
          {r.health || '—'}
        </span>
      ),
    },
  ]

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="text-error text-[12.5px] max-w-lg text-center whitespace-pre-wrap">
          {error}
        </div>
      </div>
    )
  }

  if (!items) {
    return (
      <div className="flex-1 flex items-center justify-center text-tertiary text-[12.5px]">
        Loading alerts…
      </div>
    )
  }

  // The unfiltered total already lives in the toolbar's "N items" count, so the
  // strip carries only what a glance at the table can't tell you: how many rules
  // are actually firing or pending. Hidden entirely when everything is healthy.
  const hasActive = summary.firing > 0 || summary.pending > 0

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {menu}
      {hasActive && (
        <div className="flex items-center gap-3 px-4 h-9 border-b border-zGray-800/60 text-[12px]">
          {summary.firing > 0 && (
            <span className="inline-flex items-center gap-1.5 text-error">
              <AlertTriangle className="w-3.5 h-3.5" strokeWidth={2} />
              {summary.firing} firing
            </span>
          )}
          {summary.pending > 0 && (
            <span className="inline-flex items-center gap-1.5 text-zViolet-accent">
              <Clock className="w-3.5 h-3.5" strokeWidth={2} />
              {summary.pending} pending
            </span>
          )}
        </div>
      )}
      <Table<AlertRuleSummary>
        columns={columns}
        rows={filtered}
        rowKey={(r) => r.uid}
        onRowContextMenu={onRowContextMenu}
        storageKey="observability.alerts"
        empty={`No alerts match "${filter ?? ''}"`}
      />
    </div>
  )
}

function firingInstanceCount(r: AlertRuleSummary): number {
  return r.alerts.filter((a) => a.state === 'firing' || a.state === 'pending').length
}

// Sort priority — firing first, then pending, then problematic states, normal last.
function stateRank(s: AlertState): number {
  switch (s) {
    case 'firing':
      return 0
    case 'pending':
      return 1
    case 'error':
      return 2
    case 'nodata':
      return 3
    case 'inactive':
    case 'normal':
      return 4
  }
}

function StateBadge({ state }: { state: AlertState }) {
  const cfg = stateBadgeConfig(state)
  const Icon = cfg.icon

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[11.5px] ${cfg.className}`}
    >
      <Icon className="w-3 h-3" strokeWidth={2} />
      {cfg.label}
    </span>
  )
}

function stateBadgeConfig(state: AlertState): {
  label: string
  icon: typeof Bell
  className: string
} {
  switch (state) {
    case 'firing':
      return {
        label: 'Firing',
        icon: AlertTriangle,
        className: 'bg-error/15 text-error',
      }
    case 'pending':
      return {
        label: 'Pending',
        icon: Clock,
        className: 'bg-zViolet-500/15 text-zViolet-accent',
      }
    case 'nodata':
      return {
        label: 'No data',
        icon: CircleSlash,
        className: 'bg-zGray-800/60 text-tertiary',
      }
    case 'error':
      return {
        label: 'Error',
        icon: AlertTriangle,
        className: 'bg-error/15 text-error',
      }
    case 'inactive':
    case 'normal':
      return {
        label: 'Normal',
        icon: CircleCheck,
        className: 'bg-zGray-800/60 text-secondary',
      }
  }
}
