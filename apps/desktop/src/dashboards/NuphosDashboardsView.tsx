import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { ConfirmDialog } from '../components/ConfirmDialog'
import { RefreshButton } from '../components/toolbar-controls'
import { useToolbarHeaderRightSlot } from '../hooks/useToolbarControls'
import { useToolbarPrimaryAction } from '../hooks/useToolbarPrimaryAction'
import { useWorkspaceTab } from '../hooks/useWorkspaceTab'

import { AlertModal } from './AlertModal'
import { PanelEditorModal } from './PanelEditorModal'
import { CadenceMenu } from './view/CadenceMenu'
import { DashboardCanvas } from './view/DashboardCanvas'
import { DashboardListPage } from './view/DashboardListPage'
import { DashboardToolbar } from './view/DashboardToolbar'
import { latestCompletedRefreshAt, orderPanels, refreshAge } from './view/helpers'
import { useDashboardActions } from './view/useDashboardActions'
import { useDashboardData } from './view/useDashboardData'
import { usePanelActions } from './view/usePanelActions'

import type { DashboardViewRange, NuphosDashboard, DashboardPanel, OpenAgentChat } from './schema'

type Props = {
  teamId: string
  viewRange?: DashboardViewRange
  refreshKey: number
  filter?: string
  onCount?: (n: number) => void
  onLoading?: (loading: boolean) => void
  onOpenAgentChat: OpenAgentChat
  /** Open dashboard drill-down (breadcrumb + URL own it, like Architecture's
   *  openDiagramId). Null renders the dashboard list page. */
  openDashboardId?: string | null
  /** Opens/closes a dashboard on the tab; also refines a deep-linked name. */
  onDashboardOpened?: (
    d: { dashboardId: string; dashboardName: string; viewRange?: DashboardViewRange } | null,
  ) => void
  /** Reports the loaded dashboard list so the breadcrumb switcher has options. */
  onDashboardsChange?: (dashboards: { id: string; name: string }[]) => void
}

export function NuphosDashboardsView({
  teamId,
  viewRange,
  refreshKey,
  filter = '',
  onCount,
  onLoading,
  onOpenAgentChat,
  openDashboardId,
  onDashboardOpened,
  onDashboardsChange,
}: Props) {
  const [editor, setEditor] = useState<{ panel: DashboardPanel | null } | null>(null)
  const [alertPanel, setAlertPanel] = useState<DashboardPanel | null>(null)
  const [dashboardToDelete, setDashboardToDelete] = useState<NuphosDashboard | null>(null)
  const [panelToDelete, setPanelToDelete] = useState<DashboardPanel | null>(null)
  const [customRange, setCustomRange] = useState<{ periodStart: string; periodEnd: string } | null>(
    null,
  )
  const [editingLayout, setEditingLayout] = useState(false)
  // The dashboard shows one of two sibling views: the panel canvas (data) or
  // the Insights view (AI reading). Insights never mix into the canvas.
  const [canvasView, setCanvasView] = useState<'panels' | 'insights'>('panels')
  const { isActive } = useWorkspaceTab()
  const dragFrom = useRef<number | null>(null)
  const selectedId = openDashboardId ?? null
  const headerRightSlot = useToolbarHeaderRightSlot(isActive && Boolean(selectedId))

  const {
    dashboards,
    setDashboards,
    detail,
    setDetail,
    detailError,
    setDetailError,
    loading,
    loadDetail,
  } = useDashboardData({
    teamId,
    viewRange,
    refreshKey,
    selectedId,
    onCount,
    onLoading,
    onDashboardOpened,
    onDashboardsChange,
  })

  // Opening/closing/switching a dashboard drops the stale per-dashboard UI
  // state. Adjusted during render (not from an effect) so the newly opened
  // dashboard never renders a frame carrying the previous one's editor,
  // alert panel or error banner.
  const [openedId, setOpenedId] = useState(selectedId)

  if (openedId !== selectedId) {
    setOpenedId(selectedId)
    setDetail((current) => ((current?.dashboard.id ?? null) === selectedId ? current : null))
    setDetailError(false)
    setEditor(null)
    setAlertPanel(null)
    setCanvasView('panels')
  }

  const panels = useMemo(() => (detail ? orderPanels(detail) : []), [detail])
  const lastRefreshAt = latestCompletedRefreshAt(detail)
  const selectedDashboard = useMemo(
    () => dashboards.find((dashboard) => dashboard.id === selectedId) ?? null,
    [dashboards, selectedId],
  )

  const {
    refreshing,
    creating,
    openPanelAssistant,
    createDashboard,
    deleteDashboard,
    refreshAll,
    applyDate,
  } = useDashboardActions({
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
  })

  // Publish "New dashboard" to the shared toolbar CTA slot — nothing while a
  // dashboard is open, or while this is a keep-alive'd background tab.
  useToolbarPrimaryAction(
    isActive && !selectedId ? 'New dashboard' : null,
    () => void createDashboard(),
    creating,
  )

  const {
    busyPanels,
    regenPanels,
    saving,
    onExecutePanel,
    deletePanel,
    onInsightFeedback,
    onRegenerateInsight,
    savePanel,
    onDrop,
    movePanel,
  } = usePanelActions({
    teamId,
    viewRange,
    selectedId,
    detail,
    setDetail,
    editor,
    setEditor,
    setPanelToDelete,
    panels,
    dragFromRef: dragFrom,
    loadDetail,
  })

  const visibleDashboards = useMemo(() => {
    const q = filter.trim().toLowerCase()

    return q ? dashboards.filter((d) => d.name.toLowerCase().includes(q)) : dashboards
  }, [dashboards, filter])

  // On the list page the toolbar count reflects the dashboard rows; an open
  // dashboard reports its panel count through loadDetail instead.
  useEffect(() => {
    if (selectedId) return
    onCount?.(visibleDashboards.length)
  }, [selectedId, visibleDashboards, onCount])

  // ---- Dashboard list page ----
  if (!selectedId) {
    return (
      <DashboardListPage
        loading={loading}
        dashboards={dashboards}
        visibleDashboards={visibleDashboards}
        dashboardToDelete={dashboardToDelete}
        setDashboardToDelete={setDashboardToDelete}
        createDashboard={createDashboard}
        deleteDashboard={deleteDashboard}
        onOpenAgentChat={onOpenAgentChat}
        onDashboardOpened={onDashboardOpened}
      />
    )
  }

  return (
    <div className="flex h-full flex-col">
      {headerRightSlot &&
        createPortal(
          <>
            <span
              title={lastRefreshAt ? new Date(lastRefreshAt).toLocaleString() : undefined}
              className="text-[12px] text-tertiary"
            >
              {lastRefreshAt ? `Last updated ${refreshAge(lastRefreshAt)}` : 'No completed refresh'}
            </span>
            <CadenceMenu
              teamId={teamId}
              detail={detail}
              onSaved={(dashboard) => {
                setDetail((current) => current && { ...current, dashboard })
                setDashboards((prev) => prev.map((d) => (d.id === dashboard.id ? dashboard : d)))
              }}
            />
            <RefreshButton onRefresh={() => void refreshAll(true)} loading={refreshing} />
          </>,
          headerRightSlot,
        )}
      <DashboardToolbar
        teamId={teamId}
        onDefaultSaved={loadDetail}
        detail={detail}
        viewRange={viewRange}
        panels={panels}
        canvasView={canvasView}
        setCanvasView={setCanvasView}
        customRange={customRange}
        setCustomRange={setCustomRange}
        refreshing={refreshing}
        editingLayout={editingLayout}
        setEditingLayout={setEditingLayout}
        applyDate={applyDate}
        onAddPanel={() => setEditor({ panel: null })}
        openPanelAssistant={openPanelAssistant}
      />

      <DashboardCanvas
        detail={detail}
        detailError={detailError}
        loading={loading}
        selectedId={selectedId}
        canvasView={canvasView}
        setCanvasView={setCanvasView}
        panels={panels}
        busyPanels={busyPanels}
        regenPanels={regenPanels}
        refreshing={refreshing}
        editingLayout={editingLayout}
        dragFromRef={dragFrom}
        onOpenAgentChat={onOpenAgentChat}
        openPanelAssistant={openPanelAssistant}
        onDashboardOpened={onDashboardOpened}
        loadDetail={loadDetail}
        onExecutePanel={onExecutePanel}
        onInsightFeedback={onInsightFeedback}
        onRegenerateInsight={onRegenerateInsight}
        onDrop={onDrop}
        movePanel={movePanel}
        setEditor={setEditor}
        setPanelToDelete={setPanelToDelete}
        setAlertPanel={setAlertPanel}
      />

      {editor && (
        <PanelEditorModal
          teamId={teamId}
          panel={editor.panel}
          saving={saving}
          onCancel={() => setEditor(null)}
          onSave={(input) => void savePanel(input)}
        />
      )}

      {alertPanel && selectedId && (
        <AlertModal
          teamId={teamId}
          dashboardId={selectedId}
          panel={alertPanel}
          onClose={() => setAlertPanel(null)}
        />
      )}
      <ConfirmDialog
        open={panelToDelete !== null}
        title="Delete panel?"
        description={
          panelToDelete
            ? `"${panelToDelete.title}" and its snapshots, insights, and alert will be permanently deleted.`
            : ''
        }
        confirmLabel="Delete panel"
        destructive
        onConfirm={() => (panelToDelete ? deletePanel(panelToDelete) : undefined)}
        onClose={() => setPanelToDelete(null)}
      />
    </div>
  )
}
