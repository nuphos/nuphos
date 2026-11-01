import { Palette, Pencil, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { api } from '../api'
import { ContextMenu } from '../components/ContextMenu'
import { EmptyState } from '../components/EmptyState'
import { Table } from '../components/Table'
import { toast } from '../components/ui/toast'
import { DesignCanvas } from '../design/canvas/DesignCanvas'
import { RenamePageDialog } from '../design/canvas/dialogs'
import { useToolbarPrimaryAction } from '../hooks/useToolbarPrimaryAction'
import { useWorkspaceTab } from '../hooks/useWorkspaceTab'
import { t } from '../i18n'

import { buildDesignColumns } from './designs/designColumns'
import { useResetOnKey } from './useResetOnKey'

import type { Design, DesignSummary } from '../design/schema'
import type { TeamMember } from '../types'

type Props = {
  teamId: string
  refreshKey: number
  filter?: string
  onCount?: (n: number) => void
  onLoading?: (loading: boolean) => void
  // Drill-down lives on the workspace tab so the global breadcrumb owns it.
  openDesignId?: string | null
  /** What the breadcrumb shows for it; a deep link only knows a placeholder. */
  openDesignName?: string | null
  onOpenDesign?: (id: string, name: string) => void
  onCloseDesign?: () => void
  onRenameDesign?: (name: string) => void
  /** Open a fresh agent chat and auto-send the given prompt. */
  onOpenAgentChat?: (prompt: string, options?: { send?: boolean }) => void
}

export function DesignsView({
  teamId,
  refreshKey,
  filter = '',
  onCount,
  onLoading,
  openDesignId = null,
  openDesignName = null,
  onOpenDesign,
  onCloseDesign,
  onRenameDesign,
  onOpenAgentChat,
}: Props) {
  const [designs, setDesigns] = useState<DesignSummary[]>([])
  // Local mirror of the list-fetch state: without it the Table renders the
  // empty copy for the moment between mount and the first response.
  const [listLoading, setListLoading] = useState(true)
  const [loaded, setLoaded] = useState<Design | null>(null)
  const [creating, setCreating] = useState(false)
  const [menu, setMenu] = useState<{ row: DesignSummary; x: number; y: number } | null>(null)
  const [renaming, setRenaming] = useState<DesignSummary | null>(null)
  const [members, setMembers] = useState<TeamMember[]>([])
  const membersById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members])
  const { isActive } = useWorkspaceTab()

  // Removed members included, so a design by a former teammate still shows who made it.
  useEffect(() => {
    let alive = true

    api
      .atlasListTeamMembers(teamId, true)
      .then((list) => {
        if (alive) setMembers(list)
      })
      .catch(() => {
        if (alive) setMembers([])
      })

    return () => {
      alive = false
    }
  }, [teamId])

  async function createDesign() {
    setCreating(true)
    try {
      const design = await api.designsCreate(teamId, {})

      onOpenDesign?.(design.id, design.name)
    } catch (e) {
      toast.apiError(t('Failed to create design'), e)
    } finally {
      setCreating(false)
    }
  }

  useToolbarPrimaryAction(
    isActive && !openDesignId ? t('New design') : null,
    () => void createDesign(),
    creating,
  )

  const load = useCallback(() => {
    onLoading?.(true)
    api
      .designsList(teamId)
      .then((list) => {
        setDesigns(list)
        onCount?.(list.length)
      })
      .catch((e: unknown) => {
        toast.apiError(t('Failed to load designs'), e)
      })
      .finally(() => {
        onLoading?.(false)
        setListLoading(false)
      })
  }, [teamId, onCount, onLoading])

  useResetOnKey(`${teamId}|${String(refreshKey)}|${String(openDesignId)}`, () => {
    if (!openDesignId) setListLoading(true)
  })
  useEffect(() => {
    if (!openDesignId) load()
  }, [load, refreshKey, openDesignId])

  // A design id is only unique within a team — drop any cached design when the
  // team changes so the id check below can't render another team's data.
  useResetOnKey(teamId, () => setLoaded(null))
  useResetOnKey(String(openDesignId), () => {
    if (!openDesignId) setLoaded(null)
  })

  useEffect(() => {
    if (!openDesignId) return
    if (loaded?.id === openDesignId) return
    let cancelled = false

    api
      .designsGet(teamId, openDesignId)
      .then((d) => {
        if (!cancelled) setLoaded(d)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        toast.apiError(t('Failed to open design'), e)
        onCloseDesign?.()
      })

    return () => {
      cancelled = true
    }
  }, [teamId, openDesignId, loaded?.id, onCloseDesign])

  const remove = useCallback(
    async (id: string) => {
      setDesigns((list) => {
        const next = list.filter((d) => d.id !== id)

        onCount?.(next.length)

        return next
      })
      try {
        await api.designsDelete(teamId, id)
      } catch (e) {
        toast.apiError(t('Failed to delete design'), e)
        load()
      }
    },
    [teamId, load, onCount],
  )

  const rename = useCallback(
    async (id: string, name: string) => {
      setDesigns((list) => list.map((d) => (d.id === id ? { ...d, name } : d)))
      try {
        await api.designsApplyOps(teamId, id, [{ op: 'rename', name }])
      } catch (e) {
        toast.apiError(t('Failed to rename design'), e)
        load()
      }
    },
    [teamId, load],
  )

  if (openDesignId) {
    if (loaded?.id !== openDesignId) {
      return <div className="px-6 py-6 text-[13px] text-tertiary">{t('Loading…')}</div>
    }

    return (
      <DesignCanvas
        key={loaded.id}
        teamId={teamId}
        initial={loaded}
        shownName={openDesignName}
        onRename={(name) => onRenameDesign?.(name)}
        onOpenAgentChat={onOpenAgentChat}
      />
    )
  }

  const visible = filter
    ? designs.filter((d) => d.name.toLowerCase().includes(filter.toLowerCase()))
    : designs

  const columns = buildDesignColumns(membersById)

  return (
    <>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              key: 'rename',
              label: t('Rename'),
              icon: Pencil,
              onSelect: () => setRenaming(menu.row),
            },
            {
              key: 'delete',
              label: t('Delete design'),
              icon: Trash2,
              destructive: true,
              confirm: t('Delete "{name}"? This is irreversible.', { name: menu.row.name }),
              onSelect: () => void remove(menu.row.id),
            },
          ]}
        />
      )}
      {renaming && (
        <RenamePageDialog
          name={renaming.name}
          title={t('Rename design')}
          onClose={() => setRenaming(null)}
          onSave={(name) => {
            void rename(renaming.id, name)
            setRenaming(null)
          }}
        />
      )}
      {!listLoading && designs.length === 0 ? (
        <EmptyState
          icon={Palette}
          title={t('Designs')}
          description={t(
            "Lay out a product's screens on one canvas: live HTML frames, sections, notes and the flow between them. Start from scratch, or let the agent sketch the screens.",
          )}
          primaryAction={{
            label: t('New design'),
            icon: Plus,
            onClick: () => void createDesign(),
            disabled: creating,
          }}
          agentAction={{
            label: t('Sketch my screens for me'),
            prompt:
              'Use the design-canvas skill to create a design for this product: look at the codebase or ask me what we are building, then lay out the main screens as frames on one page with the flow between them.',
          }}
          onOpenAgentChat={onOpenAgentChat}
        />
      ) : (
        <Table<DesignSummary>
          columns={columns}
          rows={visible}
          rowKey={(d) => d.id}
          onPrimaryAction={(d) => onOpenDesign?.(d.id, d.name)}
          onRowContextMenu={(row, e) => setMenu({ row, x: e.clientX, y: e.clientY })}
          storageKey="designs"
          defaultSort={{ key: 'updated', dir: 'desc' }}
          loading={listLoading}
        />
      )}
    </>
  )
}
