import { ChevronRight, Database, Route } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { Table } from '../components/Table'
import { Button } from '../components/ui/button'
import { listDatasources, isLokiDatasource, isTempoDatasource } from '../grafana/client'
import { useSilentRefresh } from '../hooks/useSilentRefresh'
import { useWorkspaceTab } from '../hooks/useWorkspaceTab'
import { useLinkOnlyRowMenu, useWorkspaceRowLink } from '../lib/workspaceRowLink'

import { useResetOnKey } from './useResetOnKey'

import type { Column } from '../components/Table'
import type { DatasourceSummary, GrafanaTarget } from '../grafana/client'

type Props = {
  target: GrafanaTarget
  filter?: string
  onCount?: (n: number) => void
  onOpenTraceExplorer?: (ds: DatasourceSummary) => void
  onOpenLogExplorer?: (ds: DatasourceSummary) => void
}

export function GrafanaDatasourceListView({
  target,
  filter,
  onCount,
  onOpenTraceExplorer,
  onOpenLogExplorer,
}: Props) {
  const [items, setItems] = useState<DatasourceSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useResetOnKey(`${target.teamId}|${target.instanceId}`, () => {
    setItems(null)
    setError(null)
  })

  useEffect(() => {
    let cancelled = false

    listDatasources(target)
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

  useSilentRefresh(() => listDatasources(target), pollTick, setItems, setError)

  const effectiveFilter = (filter ?? '').trim().toLowerCase()

  const filtered = useMemo(() => {
    const list = items ?? []

    if (!effectiveFilter) return list

    // The toolbar search already narrows by type (e.g. "prometheus"), so a
    // dedicated type dropdown would only duplicate it — and rebuild the header
    // band this page just shed.
    return list.filter(
      (d) =>
        d.name.toLowerCase().includes(effectiveFilter) ||
        d.uid.toLowerCase().includes(effectiveFilter) ||
        d.type.toLowerCase().includes(effectiveFilter),
    )
  }, [items, effectiveFilter])

  useEffect(() => {
    onCount?.(filtered.length)
  }, [filtered.length, onCount])

  const { linkForRow } = useWorkspaceRowLink()
  const baseDatasourcesPath = `/teams/${encodeURIComponent(target.teamId)}/observability/grafana/${encodeURIComponent(target.instanceId)}/datasources`
  const getRowLink = useCallback(
    (x: DatasourceSummary) => {
      const uid = x.uid || x.name
      const suffix = isTempoDatasource(x)
        ? '/trace-explorer'
        : isLokiDatasource(x)
          ? '/log-explorer'
          : ''

      return linkForRow({
        path: `${baseDatasourcesPath}/${encodeURIComponent(uid)}${suffix}`,
      })
    },
    [linkForRow, baseDatasourcesPath],
  )
  const { onRowContextMenu, menu } = useLinkOnlyRowMenu(getRowLink)

  const columns: Column<DatasourceSummary>[] = [
    {
      key: 'name',
      header: 'Name',
      width: 260,
      sortAccessor: (x) => x.name,
      render: (x) => (
        <span className="inline-flex items-center gap-2 min-w-0">
          {isLokiDatasource(x) ? (
            // Grafana's official Loki brand mark, bundled locally (not on any
            // icon CDN) — same approach as vanta/secureframe.
            <img src="/loki.svg" alt="" className="w-3.5 h-3.5 flex-shrink-0" />
          ) : isTempoDatasource(x) ? (
            <Route className="w-3.5 h-3.5 text-zViolet-accent flex-shrink-0" strokeWidth={1.8} />
          ) : (
            <Database className="w-3.5 h-3.5 text-zViolet-accent flex-shrink-0" strokeWidth={1.8} />
          )}
          <span className="truncate">{x.name}</span>
        </span>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      width: 220,
      sortAccessor: (x) => x.type,
      render: (x) => <span className="text-secondary">{x.type}</span>,
    },
    {
      key: 'uid',
      header: 'UID',
      width: 300,
      sortAccessor: (x) => x.uid,
      render: (x) => <span className="font-mono text-[12px] text-tertiary">{x.uid}</span>,
    },
    {
      // Not `actions`: Table persists per-key column widths in localStorage,
      // and the old 60px `actions` width would clip the Explore button.
      key: 'explore',
      header: '',
      width: 120,
      render: (x) =>
        isTempoDatasource(x) || isLokiDatasource(x) ? (
          <span className="inline-flex w-full justify-end">
            <Button
              variant="secondary"
              size="sm"
              className="h-6 px-2 text-[12px]"
              onClick={(e) => {
                e.stopPropagation()
                if (isTempoDatasource(x)) onOpenTraceExplorer?.(x)
                else onOpenLogExplorer?.(x)
              }}
            >
              Explore
              <ChevronRight className="w-3 h-3" strokeWidth={1.8} />
            </Button>
          </span>
        ) : null,
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
        Loading datasources…
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {menu}
      <Table<DatasourceSummary>
        columns={columns}
        rows={filtered}
        rowKey={(x) => x.uid || `${x.type}:${x.name}`}
        onPrimaryAction={(x) => {
          if (isTempoDatasource(x)) onOpenTraceExplorer?.(x)
          else if (isLokiDatasource(x)) onOpenLogExplorer?.(x)
        }}
        onRowContextMenu={onRowContextMenu}
        storageKey="observability.datasources"
        empty={`No datasources match "${filter ?? ''}"`}
      />
    </div>
  )
}
