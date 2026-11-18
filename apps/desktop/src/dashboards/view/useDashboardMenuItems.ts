import { Lock, Trash2, Users } from 'lucide-react'
import { useCallback } from 'react'

import { api } from '../../api'
import { toast } from '../../components/ui/toast'
import { useCurrentUser } from '../../hooks/useCurrentUser'
import { useTeamRole } from '../../hooks/useTeamRole'
import { t } from '../../i18n'

import { canEditDashboard, moveTarget } from './visibility'

import type { ContextMenuItem } from '../../components/ContextMenu'
import type { DashboardVisibility, NuphosDashboard } from '../schema'
import type { Dispatch, SetStateAction } from 'react'

/**
 * What a dashboard's menu in the list offers this member: moving it between
 * Personal and Team, as its creator, and deleting it, where they may.
 */
export function useDashboardMenuItems(
  teamId: string,
  setDashboards: Dispatch<SetStateAction<NuphosDashboard[]>>,
  onDelete: (dashboard: NuphosDashboard) => void,
) {
  const role = useTeamRole(teamId)
  const userId = useCurrentUser()?.id

  const move = useCallback(
    async (dashboard: NuphosDashboard, visibility: DashboardVisibility) => {
      try {
        const saved = await api.dashboardsUpdate(teamId, dashboard.id, { visibility })

        setDashboards((prev) => prev.map((d) => (d.id === saved.id ? saved : d)))
      } catch (err) {
        toast.apiError(t('Could not move dashboard'), err)
      }
    },
    [teamId, setDashboards],
  )

  return (row: NuphosDashboard): ContextMenuItem[] => {
    const to = moveTarget(row, userId, role)
    const items: ContextMenuItem[] = []

    if (to) {
      items.push({
        key: 'move',
        label: to === 'team' ? t('Move to Team') : t('Move to Personal'),
        icon: to === 'team' ? Users : Lock,
        onSelect: () => move(row, to),
      })
    }
    if (canEditDashboard(row, userId, role)) {
      items.push({
        key: 'delete',
        label: t('Delete dashboard'),
        icon: Trash2,
        destructive: true,
        // Confirmation is the list's richer ConfirmDialog, not the menu's own
        // one-line prompt — it spells out what else gets deleted.
        onSelect: () => onDelete(row),
      })
    }

    return items
  }
}
