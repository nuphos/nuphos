import { faDiagramProject } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { Network, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { api } from '../api'
import { DiagramCanvas } from '../architecture/Canvas'
import { ContextMenu } from '../components/ContextMenu'
import { EmptyState } from '../components/EmptyState'
import { Table } from '../components/Table'
import { toast } from '../components/ui/toast'
import { useToolbarPrimaryAction } from '../hooks/useToolbarPrimaryAction'
import { useWorkspaceTab } from '../hooks/useWorkspaceTab'

import { useResetOnKey } from './useResetOnKey'

import type { Diagram, DiagramSummary } from '../architecture/schema'
import type { Column } from '../components/Table'

type Props = {
  teamId: string
  refreshKey: number
  filter?: string
  onCount?: (n: number) => void
  onLoading?: (loading: boolean) => void
  // Drill-down lives on the workspace tab so the global breadcrumb owns it.
  openDiagramId?: string | null
  onOpenDiagram?: (id: string, name: string) => void
  onCloseDiagram?: () => void
  onRenameDiagram?: (name: string) => void
  // Open a node's link: nuphos.ai pages open in-app, everything else external.
  onOpenUrl?: (url: string) => void
  /** Open a fresh agent chat and auto-send the given prompt. */
  onOpenAgentChat?: (prompt: string, options?: { send?: boolean }) => void
}

export function ArchitectureView({
  teamId,
  refreshKey,
  filter = '',
  onCount,
  onLoading,
  openDiagramId = null,
  onOpenDiagram,
  onCloseDiagram,
  onRenameDiagram,
  onOpenUrl,
  onOpenAgentChat,
}: Props) {
  const [diagrams, setDiagrams] = useState<DiagramSummary[]>([])
  // Local mirror of the list-fetch state: without it the Table renders the
  // empty copy for the moment between mount and the first response.
  const [listLoading, setListLoading] = useState(true)
  // The full diagram fetched for the open drill-down (the list only has summaries).
  const [loaded, setLoaded] = useState<Diagram | null>(null)
  const [creating, setCreating] = useState(false)
  const [menu, setMenu] = useState<{ row: DiagramSummary; x: number; y: number } | null>(null)
  const { isActive } = useWorkspaceTab()

  async function createDiagram() {
    setCreating(true)
    try {
      const dg = await api.archCreateDiagram(teamId, 'Untitled diagram')

      onOpenDiagram?.(dg.id, dg.name)
    } catch (e) {
      toast.apiError('Failed to create diagram', e)
    } finally {
      setCreating(false)
    }
  }

  // Publish "New diagram" to the shared toolbar CTA slot (nothing while drilled
  // into a diagram, or while this is a keep-alive'd background tab). Creating and
  // opening both live here now, not in App.
  useToolbarPrimaryAction(
    isActive && !openDiagramId ? 'New diagram' : null,
    () => void createDiagram(),
    creating,
  )

  const load = useCallback(() => {
    onLoading?.(true)
    api
      .archListDiagrams(teamId)
      .then((list) => {
        setDiagrams(list)
        onCount?.(list.length)
      })
      .catch((e: unknown) => {
        toast.apiError('Failed to load diagrams', e)
      })
      .finally(() => {
        onLoading?.(false)
        setListLoading(false)
      })
  }, [teamId, onCount, onLoading])

  // Reset during render (not in the effect below — synchronous setState in an
  // effect cascades) so the refetch never renders a frame of stale "empty".
  useResetOnKey(`${teamId}|${String(refreshKey)}|${String(openDiagramId)}`, () => {
    if (!openDiagramId) setListLoading(true)
  })
  useEffect(() => {
    if (!openDiagramId) load()
  }, [load, refreshKey, openDiagramId])

  // A diagram id is only unique within a team — drop any cached diagram when the
  // team changes so the id check below can't render another team's data.
  useResetOnKey(teamId, () => setLoaded(null))
  // Drop it again when the drill-down closes.
  useResetOnKey(String(openDiagramId), () => {
    if (!openDiagramId) setLoaded(null)
  })

  // Fetch the full diagram when one is opened (unless we already hold it).
  useEffect(() => {
    if (!openDiagramId) return
    if (loaded?.id === openDiagramId) return
    let cancelled = false

    api
      .archGetDiagram(teamId, openDiagramId)
      .then((d) => {
        if (!cancelled) setLoaded(d)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        toast.apiError('Failed to open diagram', e)
        onCloseDiagram?.()
      })

    return () => {
      cancelled = true
    }
  }, [teamId, openDiagramId, loaded?.id, onCloseDiagram])

  const remove = useCallback(
    async (id: string) => {
      setDiagrams((list) => {
        const next = list.filter((d) => d.id !== id)

        onCount?.(next.length)

        return next
      })
      try {
        await api.archDeleteDiagram(teamId, id)
      } catch (e) {
        toast.apiError('Failed to delete diagram', e)
        load()
      }
    },
    [teamId, load, onCount],
  )

  if (openDiagramId) {
    if (loaded?.id !== openDiagramId) {
      return <div className="px-6 py-6 text-[13px] text-tertiary">Loading…</div>
    }

    return (
      <DiagramCanvas
        teamId={teamId}
        initial={loaded}
        onRename={(name) => onRenameDiagram?.(name)}
        onOpenUrl={onOpenUrl}
      />
    )
  }

  const visible = filter
    ? diagrams.filter((d) => d.name.toLowerCase().includes(filter.toLowerCase()))
    : diagrams

  const columns: Column<DiagramSummary>[] = [
    {
      key: 'name',
      header: 'Name',
      sortAccessor: (d) => d.name.toLowerCase(),
      render: (d) => (
        <span className="inline-flex items-center gap-2 text-main">
          <FontAwesomeIcon icon={faDiagramProject} className="w-3.5 h-3.5 text-tertiary" />
          <span className="truncate">{d.name}</span>
        </span>
      ),
    },
    {
      key: 'nodes',
      header: 'Nodes',
      width: 110,
      sortAccessor: (d) => d.nodeCount,
      render: (d) => <span className="text-tertiary font-mono text-[12px]">{d.nodeCount}</span>,
    },
    {
      key: 'views',
      header: 'Views',
      width: 110,
      sortAccessor: (d) => d.viewCount,
      render: (d) => <span className="text-tertiary font-mono text-[12px]">{d.viewCount}</span>,
    },
    {
      key: 'updated',
      header: 'Updated',
      width: 160,
      sortAccessor: (d) => d.updatedAt,
      render: (d) => (
        <span className="text-tertiary font-mono text-[12px]">
          {new Date(d.updatedAt).toLocaleDateString()}
        </span>
      ),
    },
  ]

  return (
    <>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              key: 'delete',
              label: 'Delete diagram',
              icon: Trash2,
              destructive: true,
              confirm: `Delete "${menu.row.name}"? This is irreversible.`,
              onSelect: () => void remove(menu.row.id),
            },
          ]}
        />
      )}
      {!listLoading && diagrams.length === 0 ? (
        <EmptyState
          icon={Network}
          title="Architecture"
          description="Architecture diagrams map how your systems connect. Create one from scratch, or let the agent chart your systems."
          primaryAction={{
            label: 'New diagram',
            icon: Plus,
            onClick: () => void createDiagram(),
            disabled: creating,
          }}
          agentAction={{
            label: 'Map my system for me',
            prompt:
              'Map my system architecture — look at my connected accounts and create an architecture diagram of how everything connects.',
          }}
          onOpenAgentChat={onOpenAgentChat}
        />
      ) : (
        <Table<DiagramSummary>
          columns={columns}
          rows={visible}
          rowKey={(d) => d.id}
          onPrimaryAction={(d) => onOpenDiagram?.(d.id, d.name)}
          onRowContextMenu={(row, e) => setMenu({ row, x: e.clientX, y: e.clientY })}
          storageKey="architecture-diagrams"
          defaultSort={{ key: 'updated', dir: 'desc' }}
          loading={listLoading}
          empty="No diagrams match the current search."
        />
      )}
    </>
  )
}
