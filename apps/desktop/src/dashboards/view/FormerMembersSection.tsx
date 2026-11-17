import { Trash2, Users } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api } from '../../api'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ContextMenu } from '../../components/ContextMenu'
import { Table } from '../../components/Table'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

import { SectionHeading } from './SectionHeading'

import type { Column } from '../../components/Table'
import type { NuphosDashboard } from '../schema'
import type { Dispatch, SetStateAction } from 'react'

/**
 * Personal dashboards whose creators are no longer in the team, for an Administrator,
 * who takes them over: open one to see what it holds, then move it to Team so the
 * team keeps it, or delete it. The backend sends these only to Administrators. The
 * table is the list's own, with a column naming the creator.
 */
export function FormerMembersSection({
  teamId,
  columns,
  setDashboards,
  onOpen,
}: {
  teamId: string
  columns: Column<NuphosDashboard>[]
  setDashboards: Dispatch<SetStateAction<NuphosDashboard[]>>
  onOpen: (dashboard: NuphosDashboard) => void
}) {
  const [left, setLeft] = useState<NuphosDashboard[]>([])
  const [names, setNames] = useState<Map<string, string>>(new Map())
  const [menu, setMenu] = useState<{ row: NuphosDashboard; x: number; y: number } | null>(null)
  const [toDelete, setToDelete] = useState<NuphosDashboard | null>(null)

  useEffect(() => {
    let cancelled = false

    api
      .dashboardsFormerMembers(teamId)
      .then((list) => !cancelled && setLeft(list))
      .catch(() => !cancelled && setLeft([]))
    // Their creators have left, so only the list with removed members names them.
    api
      .atlasListTeamMembers(teamId, true)
      .then((members) => !cancelled && setNames(new Map(members.map((m) => [m.id, m.name]))))
      .catch(() => !cancelled && setNames(new Map()))

    return () => {
      cancelled = true
    }
  }, [teamId])

  if (left.length === 0) return null

  const creatorName = (d: NuphosDashboard) => names.get(d.createdBy) ?? t('Former member')
  const creator: Column<NuphosDashboard> = {
    key: 'createdBy',
    header: t('Created by'),
    width: 160,
    sortAccessor: (d) => creatorName(d).toLowerCase(),
    render: (d) => <span className="truncate text-[12px] text-tertiary">{creatorName(d)}</span>,
  }
  const withCreator = [...columns.slice(0, 1), creator, ...columns.slice(1)]

  const moveToTeam = async (dashboard: NuphosDashboard) => {
    try {
      const saved = await api.dashboardsUpdate(teamId, dashboard.id, { visibility: 'team' })

      setLeft((prev) => prev.filter((d) => d.id !== saved.id))
      setDashboards((prev) => [saved, ...prev])
    } catch (err) {
      toast.apiError(t('Could not move dashboard'), err)
    }
  }

  return (
    <section className="mb-6">
      <SectionHeading
        title={t('Personal dashboards of former members')}
        hint={t(
          'Their creators are no longer in the team. You can open them, move them to Team, or delete them.',
        )}
      />
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              key: 'move',
              label: t('Move to Team'),
              icon: Users,
              onSelect: () => moveToTeam(menu.row),
            },
            {
              key: 'delete',
              label: t('Delete dashboard'),
              icon: Trash2,
              destructive: true,
              onSelect: () => setToDelete(menu.row),
            },
          ]}
        />
      )}
      <Table<NuphosDashboard>
        columns={withCreator}
        rows={left}
        rowKey={(d) => d.id}
        onPrimaryAction={onOpen}
        onRowContextMenu={(row, e) => setMenu({ row, x: e.clientX, y: e.clientY })}
        storageKey="former-member-dashboards"
        defaultSort={{ key: 'updated', dir: 'desc' }}
      />
      <ConfirmDialog
        open={toDelete !== null}
        title={t('Delete dashboard?')}
        description={
          toDelete
            ? t(
                '"{name}" and all of its panels, snapshots, and alerts will be permanently deleted.',
                { name: toDelete.name },
              )
            : ''
        }
        confirmLabel={t('Delete dashboard')}
        destructive
        onConfirm={async () => {
          if (!toDelete) return
          try {
            await api.dashboardsDelete(teamId, toDelete.id)
            setLeft((prev) => prev.filter((d) => d.id !== toDelete.id))
          } catch (err) {
            toast.apiError(t('Could not delete dashboard'), err)
          }
        }}
        onClose={() => setToDelete(null)}
      />
    </section>
  )
}
