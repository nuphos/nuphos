import { Loader2, Plus } from 'lucide-react'

import { Button } from '../../components/ui/button'
import { t } from '../../i18n'
import { PanelCard } from '../PanelCard'

import type { NuphosDashboardDetail, DashboardPanel, OpenAgentChat } from '../schema'
import type { Dispatch, RefObject, SetStateAction } from 'react'

type Props = {
  detail: NuphosDashboardDetail | null
  detailError: boolean
  loading: boolean
  selectedId: string
  panels: DashboardPanel[]
  busyPanels: Set<string>
  refreshing: boolean
  editingLayout: boolean
  dragFromRef: RefObject<number | null>
  onOpenAgentChat: OpenAgentChat
  openPanelAssistant: () => void
  onDashboardOpened?: (d: { dashboardId: string; dashboardName: string } | null) => void
  loadDetail: (id: string, opts?: { silent?: boolean }) => Promise<void>
  onExecutePanel: (panel: DashboardPanel) => void
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
  panels,
  busyPanels,
  refreshing,
  editingLayout,
  dragFromRef,
  onOpenAgentChat,
  openPanelAssistant,
  onDashboardOpened,
  loadDetail,
  onExecutePanel,
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
            <span>{t('Could not load this dashboard.')}</span>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-md border border-zGray-800 px-2.5 py-1.5 hover:bg-zGray-800 hover:text-main"
                onClick={() => onDashboardOpened?.(null)}
              >
                {t('Back to dashboards')}
              </button>
              <Button
                size="sm"
                type="button"
                onClick={() => {
                  if (selectedId) void loadDetail(selectedId)
                }}
              >
                {t('Retry')}
              </Button>
            </div>
          </div>
        ) : loading ? (
          <div className="flex h-40 items-center justify-center gap-2 text-[13px] text-tertiary">
            <Loader2 className="h-4 w-4 animate-spin" /> {t('Loading…')}
          </div>
        ) : null
      ) : panels.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
          <div className="text-[14px] text-tertiary">{t('This dashboard is empty.')}</div>
          <Button size="sm" type="button" onClick={openPanelAssistant}>
            <Plus className="h-4 w-4" /> {t('Add your first panel')}
          </Button>
        </div>
      ) : (
        <>
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
                  onAskAgent={(p) =>
                    onOpenAgentChat(
                      `About the panel "${p.title}" (panel ID "${p.id}") on dashboard ID "${selectedId}": `,
                      { send: false },
                    )
                  }
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
                          'aria-label': t('Move {title}; use the up and down arrow keys', {
                            title: panel.title,
                          }),
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
