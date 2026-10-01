import { useCallback, useRef, useState } from 'react'

import { api } from '../../api'
import { toast } from '../../components/ui/toast'

import { createNuphosDashboard } from './helpers'

import type {
  DashboardViewRange,
  NuphosDashboard,
  NuphosDashboardDetail,
  OpenAgentChat,
} from '../schema'
import type { Dispatch, SetStateAction } from 'react'

type Args = {
  teamId: string
  viewRange?: DashboardViewRange
  selectedId: string | null
  dashboards: NuphosDashboard[]
  setDashboards: Dispatch<SetStateAction<NuphosDashboard[]>>
  detail: NuphosDashboardDetail | null
  selectedDashboard: NuphosDashboard | null
  loadDetail: (id: string, opts?: { silent?: boolean }) => Promise<void>
  onDashboardOpened?: (
    d: { dashboardId: string; dashboardName: string; viewRange?: DashboardViewRange } | null,
  ) => void
  onOpenAgentChat: OpenAgentChat
  setDashboardToDelete: Dispatch<SetStateAction<NuphosDashboard | null>>
  setCustomRange: Dispatch<SetStateAction<{ periodStart: string; periodEnd: string } | null>>
}

export function useDashboardActions({
  teamId,
  viewRange,
  selectedId,
  dashboards,
  setDashboards,
  detail,
  selectedDashboard,
  loadDetail,
  onDashboardOpened,
  onOpenAgentChat,
  setDashboardToDelete,
  setCustomRange,
}: Args) {
  const [refreshing, setRefreshing] = useState(false)
  const [creating, setCreating] = useState(false)
  // Ref guard as well as state: the toolbar CTA reads `disabled` a render late,
  // so a double click must be rejected synchronously.
  const creatingRef = useRef(false)

  const openPanelAssistant = useCallback(() => {
    if (!selectedId) return
    const dashboardName =
      selectedDashboard?.name ?? detail?.dashboard.name ?? 'the current dashboard'

    onOpenAgentChat(
      `Add exactly one panel to "${dashboardName}". Its immutable dashboard ID is "${selectedId}". Ask what metric or question to chart if it is not specified.`,
      { send: false },
    )
  }, [selectedId, selectedDashboard?.name, detail?.dashboard.name, onOpenAgentChat])

  const createDashboard = useCallback(async () => {
    if (creatingRef.current) return
    creatingRef.current = true
    setCreating(true)
    try {
      const created = await createNuphosDashboard(teamId, dashboards.length > 0)

      setDashboards((prev) => [created, ...prev])
      onDashboardOpened?.({ dashboardId: created.id, dashboardName: created.name })
    } catch (err) {
      toast.apiError('Could not create dashboard', err)
    } finally {
      creatingRef.current = false
      setCreating(false)
    }
  }, [teamId, dashboards.length, onDashboardOpened, setDashboards])

  const deleteDashboard = useCallback(
    async (dashboard: NuphosDashboard) => {
      try {
        await api.dashboardsDelete(teamId, dashboard.id)
        setDashboards((prev) => prev.filter((d) => d.id !== dashboard.id))
        if (selectedId === dashboard.id) onDashboardOpened?.(null)
        setDashboardToDelete(null)
      } catch (err) {
        toast.apiError('Could not delete dashboard', err)
        throw err
      }
    },
    [teamId, selectedId, onDashboardOpened, setDashboards, setDashboardToDelete],
  )

  // Refresh always forces a fresh provider fetch. Changing dates can reuse
  // matching snapshots; neither path starts a new AI insight automatically.
  const refreshAll = useCallback(
    async (force: boolean) => {
      if (!selectedId) return
      setRefreshing(true)
      try {
        await api.dashboardsRefresh(teamId, selectedId, force, viewRange)
        await loadDetail(selectedId)
      } catch (err) {
        toast.apiError('Refresh failed', err)
      } finally {
        setRefreshing(false)
      }
    },
    [teamId, selectedId, loadDetail, viewRange],
  )

  const applyDate = useCallback(
    (patch: DashboardViewRange) => {
      if (!selectedId) return
      setCustomRange(null)
      onDashboardOpened?.({
        dashboardId: selectedId,
        dashboardName: selectedDashboard?.name ?? detail?.dashboard.name ?? 'Dashboard',
        viewRange: patch,
      })
    },
    [
      selectedId,
      selectedDashboard?.name,
      detail?.dashboard.name,
      onDashboardOpened,
      setCustomRange,
    ],
  )

  return {
    refreshing,
    creating,
    openPanelAssistant,
    createDashboard,
    deleteDashboard,
    refreshAll,
    applyDate,
  }
}
