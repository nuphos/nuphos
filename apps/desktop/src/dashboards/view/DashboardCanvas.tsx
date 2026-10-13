import { Loader2, Plus } from 'lucide-react'

import { InsightsAnomalyBanner, InsightsSection } from '../InsightsSection'
import { PanelCard } from '../PanelCard'

import type { NuphosDashboardDetail, DashboardPanel, OpenAgentChat } from '../schema'
import type { Dispatch, RefObject, SetStateAction } from 'react'

type Props = {
  detail: NuphosDashboardDetail | null
  detailError: boolean
  loading: boolean
  selectedId: string
  canvasView: 'panels' | 'insights'
  setCanvasView: Dispatch<SetStateAction<'panels' | 'insights'>>
  panels: DashboardPanel[]
  busyPanels: Set<string>
  regenPanels: Set<string>
  refreshing: boolean
  editingLayout: boolean
  dragFromRef: RefObject<number | null>
  onOpenAgentChat: OpenAgentChat
  openPanelAssistant: () => void
  onDashboardOpened?: (d: { dashboardId: string; dashboardName: string } | null) => void
  loadDetail: (id: string, opts?: { silent?: boolean }) => Promise<void>
  onExecutePanel: (panel: DashboardPanel) => void
  onInsightFeedback: (panel: DashboardPanel, rating: 'up' | 'down') => void
  onRegenerateInsight: (panel: DashboardPanel) => void
  onDrop: (to: number) => void
  movePanel: (from: number, offset: -1 | 1) => void
  setEditor: Dispatch<SetStateAction<{ panel: DashboardPanel | null } | null>>
  setPanelToDelete: Dispatch<SetStateAction<DashboardPanel | null>>
  setAlertPanel: Dispatch<SetStateAction<DashboardPanel | null>>
}

export function DashboardCanvas({
  detail,
  detailError,
  loading,
  selectedId,
  canvasView,
  setCanvasView,
  panels,
  busyPanels,
  regenPanels,
  refreshing,
  editingLayout,
  dragFromRef,
  onOpenAgentChat,
  openPanelAssistant,
  onDashboardOpened,
  loadDetail,
  onExecutePanel,
  onInsightFeedback,
  onRegenerateInsight,
  onDrop,
  movePanel,
  setEditor,
  setPanelToDelete,
  setAlertPanel,
}: Props) {
  return (
    <div className="@container flex-1 overflow-auto p-4">
      {!detail ? (
        detailError ? (
          <div className="flex h-40 flex-col items-center justify-center gap-3 text-[13px] text-tertiary">
            <span>Could not load this dashboard.</span>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-md border border-zGray-800 px-2.5 py-1.5 hover:bg-zGray-800 hover:text-main"
                onClick={() => onDashboardOpened?.(null)}
              >
                Back to dashboards
              </button>
              <button
                type="button"
                className="rounded-md bg-zViolet-500 px-2.5 py-1.5 font-medium text-white hover:bg-zViolet-400"
                onClick={() => {
                  if (selectedId) void loadDetail(selectedId)
                }}
              >
                Retry
              </button>
            </div>
          </div>
        ) : loading ? (
          <div className="flex h-40 items-center justify-center gap-2 text-[13px] text-tertiary">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : null
      ) : canvasView === 'insights' ? (
        <InsightsSection
          panels={panels}
          regenPanels={regenPanels}
          onOpenAgentChat={onOpenAgentChat}
          onFeedback={onInsightFeedback}
          onRegenerate={onRegenerateInsight}
          onJumpToPanel={(id) => {
            setCanvasView('panels')
            // Wait a tick for the panel canvas to mount before scrolling.
            setTimeout(() => {
              document
                .getElementById(`dashboard-panel-${id}`)
                ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }, 100)
          }}
        />
      ) : panels.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
          <div className="text-[14px] text-tertiary">This dashboard is empty.</div>
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-md bg-zViolet-500 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-zViolet-400"
            onClick={openPanelAssistant}
          >
            <Plus className="h-4 w-4" /> Add your first panel
          </button>
        </div>
      ) : (
        <>
          {/* Only anomalies earn space ahead of the data — one warning line
              that switches to the Insights view. */}
          <InsightsAnomalyBanner panels={panels} onViewInsights={() => setCanvasView('insights')} />
          {/* Masonry via CSS columns: each column stacks its cards to content
              height, so a short scalar tile never leaves a row-height gap
              under itself the way a grid row (sized by its tallest card)
              does. */}
          <div className="columns-1 gap-3 @2xl:columns-2">
            {panels.map((panel, i) => (
              <div
                key={panel.id}
                id={`dashboard-panel-${panel.id}`}
                className="mb-3 break-inside-avoid"
                onDragOver={
                  editingLayout
                    ? (e) => {
                        e.preventDefault()
                      }
                    : undefined
                }
                onDrop={editingLayout ? () => onDrop(i) : undefined}
              >
                <PanelCard
                  panel={panel}
                  viewTimeRange={detail.viewTimeRange ?? detail.dashboard.timeRange}
                  loading={refreshing || busyPanels.has(panel.id)}
                  onExecute={onExecutePanel}
                  onEdit={(p) => setEditor({ panel: p })}
                  onDelete={setPanelToDelete}
                  onConfigureAlert={setAlertPanel}
                  dragHandleProps={
                    editingLayout
                      ? {
                          draggable: true,
                          onDragStart: () => {
                            dragFromRef.current = i
                          },
                          onKeyDown: (event) => {
                            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                            event.preventDefault()
                            movePanel(i, event.key === 'ArrowUp' ? -1 : 1)
                          },
                          'aria-label': `Move ${panel.title}; use the up and down arrow keys`,
                          onDragEnd: () => {
                            dragFromRef.current = null
                          },
                        }
                      : undefined
                  }
                />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
