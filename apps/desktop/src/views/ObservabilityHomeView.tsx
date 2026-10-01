import { CheckCircle2, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../api'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Table } from '../components/Table'
import { useSilentTick } from '../hooks/useSilentRefresh'
import { useToolbarPrimaryAction } from '../hooks/useToolbarPrimaryAction'
import { useWorkspaceTab } from '../hooks/useWorkspaceTab'
import { useLinkOnlyRowMenu, useWorkspaceRowLink } from '../lib/workspaceRowLink'

import { BindGrafanaDialog } from './BindGrafanaDialog'
import { useResetOnKey } from './useResetOnKey'

import type { Column } from '../components/Table'
import type { GrafanaInstance } from '../types'

type Props = {
  teamId: string
  filter: string
  refreshKey: number
  onCount: (n: number) => void
  onPick: (instance: GrafanaInstance) => void
}

export function ObservabilityHomeView({ teamId, filter, refreshKey, onCount, onPick }: Props) {
  const [instances, setInstances] = useState<GrafanaInstance[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [bindOpen, setBindOpen] = useState(false)
  const [unbindTarget, setUnbindTarget] = useState<GrafanaInstance | null>(null)
  // Guards against an in-flight list call clobbering newer state when the user
  // switches teams or rebinds quickly.
  const reqRef = useRef(0)

  const reload = useCallback(() => {
    const req = ++reqRef.current

    api
      .atlasListGrafanaInstances(teamId)
      .then((rows) => {
        if (req !== reqRef.current) return
        setInstances(rows)
        setError(null)
      })
      .catch((e: unknown) => {
        if (req !== reqRef.current) return
        setError(String(e instanceof Error ? e.message : e))
      })
  }, [teamId])

  useResetOnKey(`${teamId}|${String(refreshKey)}`, () => {
    setInstances(null)
    setError(null)
  })

  useEffect(() => {
    reload()
  }, [reload, refreshKey])
  const { pollTick, isActive } = useWorkspaceTab()

  useSilentTick(reload, pollTick)

  const filtered = useMemo(() => {
    const list = instances ?? []
    const f = filter.trim().toLowerCase()

    if (!f) return list

    return list.filter(
      (x) => x.name.toLowerCase().includes(f) || x.grafanaUrl.toLowerCase().includes(f),
    )
  }, [instances, filter])

  useEffect(() => {
    onCount(filtered.length)
  }, [filtered.length, onCount])

  const { linkForRow } = useWorkspaceRowLink()
  const getRowLink = useCallback(
    (x: GrafanaInstance) =>
      linkForRow({
        path: `/teams/${encodeURIComponent(teamId)}/observability/grafana/${encodeURIComponent(x.id)}`,
      }),
    [linkForRow, teamId],
  )
  const { onRowContextMenu, menu } = useLinkOnlyRowMenu(getRowLink)

  // "Bind Grafana" used to live in the PageHeader; it now publishes to the shared
  // toolbar row so it survives on the empty state too (no header to host it).
  // Gate on isActive so a keep-alive'd background tab never clobbers the active
  // page's CTA.
  useToolbarPrimaryAction(isActive ? 'Bind Grafana' : null, () => setBindOpen(true))

  const columns: Column<GrafanaInstance>[] = [
    {
      key: 'name',
      header: 'Name',
      width: 200,
      sortAccessor: (x) => x.name,
      render: (x) => <span className="text-main">{x.name}</span>,
    },
    {
      key: 'kind',
      header: 'Kind',
      width: 120,
      render: () => <span className="text-secondary">Grafana</span>,
    },
    {
      key: 'url',
      header: 'URL',
      width: 360,
      render: (x) => <span className="text-tertiary font-mono text-[12px]">{x.grafanaUrl}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      width: 140,
      render: () => (
        <span className="inline-flex items-center gap-1.5 text-[#73bf69]">
          <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={1.8} />
          Connected
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: 60,
      render: (x) => (
        <button
          onClick={(e) => {
            e.stopPropagation()
            setUnbindTarget(x)
          }}
          className="p-1 rounded text-tertiary hover:text-error hover:bg-zGray-800"
          title="Unbind"
        >
          <Trash2 className="w-3.5 h-3.5" strokeWidth={1.8} />
        </button>
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

  if (instances === null) {
    return (
      <div className="flex-1 flex items-center justify-center text-tertiary text-[12.5px]">
        Loading…
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {instances.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-tertiary text-[12.5px]">
          No Grafana instances bound to this team yet.
        </div>
      ) : (
        <>
          {menu}
          <Table<GrafanaInstance>
            columns={columns}
            rows={filtered}
            rowKey={(x) => x.id}
            onPrimaryAction={onPick}
            onRowContextMenu={onRowContextMenu}
            storageKey="observability.instances"
            empty={`No instances match "${filter}"`}
          />
        </>
      )}
      {bindOpen && (
        <BindGrafanaDialog
          teamId={teamId}
          onClose={() => setBindOpen(false)}
          onBound={() => {
            setBindOpen(false)
            reload()
          }}
        />
      )}
      {unbindTarget && (
        <ConfirmDialog
          open
          title="Unbind Grafana instance"
          description={`Remove "${unbindTarget.name}" from this team? Dashboards from this instance will no longer be accessible.`}
          confirmLabel="Unbind"
          destructive
          onClose={() => setUnbindTarget(null)}
          onConfirm={async () => {
            await api.atlasUnbindGrafanaInstance(teamId, unbindTarget.id)
            reload()
          }}
        />
      )}
    </div>
  )
}
