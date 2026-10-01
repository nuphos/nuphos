import {
  AlertTriangle,
  Bell,
  GripVertical,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { memo, useState } from 'react'

import { Menu, MenuContent, MenuItem, MenuTrigger } from '../components/ui/menu'
import { useReportVisibleError } from '../components/VisibleErrorReporter'

import { PanelOutputView } from './PanelOutputView'
import { ScriptErrorModal } from './ScriptErrorModal'

import type { DashboardPanel, DashboardPanelOutput } from './schema'
import type { HTMLAttributes } from 'react'

// Users' saved column widths and sort are stored under this key; changing it resets them.
const tableStorageKey = (panelId: string) => `costPanel.${panelId}`

type Props = {
  panel: DashboardPanel
  loading?: boolean
  onExecute: (panel: DashboardPanel) => void
  onEdit: (panel: DashboardPanel) => void
  onDelete: (panel: DashboardPanel) => void
  onConfigureAlert: (panel: DashboardPanel) => void
  dragHandleProps?: HTMLAttributes<HTMLButtonElement>
}

function outputSubtitle(output: DashboardPanelOutput | null): string | null {
  if (output?.kind === 'chart') return output.description?.trim() || null
  if (output?.kind === 'scalar') return output.sublabel?.trim() || null

  return null
}

function Body({
  panel,
  lastSuccessfulOutput,
}: {
  panel: DashboardPanel
  lastSuccessfulOutput: DashboardPanelOutput | null
}) {
  const snap = panel.currentSnapshot

  if (snap?.status === 'running') {
    return lastSuccessfulOutput ? (
      <PanelOutputView output={lastSuccessfulOutput} storageKey={tableStorageKey(panel.id)} />
    ) : (
      <div className="h-40" />
    )
  }
  if (!snap) {
    return (
      <div className="flex h-40 items-center justify-center text-[12px] text-tertiary">
        Not run yet.
      </div>
    )
  }
  if (snap.status === 'failed') {
    return lastSuccessfulOutput ? (
      <PanelOutputView output={lastSuccessfulOutput} storageKey={tableStorageKey(panel.id)} />
    ) : (
      <div className="flex h-40 items-center justify-center text-[12px] text-tertiary">
        No successful data yet.
      </div>
    )
  }
  if (!snap.output) {
    return (
      <div className="flex h-40 items-center justify-center text-[12px] text-tertiary">
        No output.
      </div>
    )
  }

  // Keyed by panel, not by snapshot: a re-run must not reset the widths the
  // user dragged on this panel's columns.
  return <PanelOutputView output={snap.output} storageKey={tableStorageKey(panel.id)} />
}

export const PanelCard = memo(
  ({
    panel,
    loading = false,
    onExecute,
    onEdit,
    onDelete,
    onConfigureAlert,
    dragHandleProps,
  }: Props) => {
    const [errorOpen, setErrorOpen] = useState(false)
    const lastSuccessful =
      panel.lastSuccessfulSnapshot ??
      (panel.currentSnapshot?.status === 'complete' ? panel.currentSnapshot : null)
    const subtitle = outputSubtitle(lastSuccessful?.output ?? null)
    const snapshotLoading = loading || panel.currentSnapshot?.status === 'running'
    const hasStaleOutput = Boolean(lastSuccessful?.output)

    useReportVisibleError(
      panel.currentSnapshot?.status === 'failed'
        ? (panel.currentSnapshot.error?.message ?? 'Panel script failed.')
        : null,
      'cost_panel_snapshot_failed',
    )

    return (
      <div className="flex flex-col overflow-hidden rounded-lg border border-zGray-800 bg-zGray-900/40">
        <div className="flex items-center gap-2 border-b border-zGray-800 px-3 py-2">
          {dragHandleProps && (
            <button
              type="button"
              className="cursor-grab text-tertiary hover:text-secondary active:cursor-grabbing"
              aria-label="Drag to reorder"
              {...dragHandleProps}
            >
              <GripVertical className="h-3.5 w-3.5" />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-medium text-main">{panel.title}</div>
            {subtitle && <div className="truncate text-[11px] text-tertiary">{subtitle}</div>}
          </div>
          <Menu>
            <MenuTrigger
              render={
                <button
                  type="button"
                  title="Panel actions"
                  aria-label={`Actions for ${panel.title}`}
                  className="rounded p-1 text-tertiary outline-none hover:bg-zGray-800 hover:text-main focus:bg-zGray-800 focus:text-main"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              }
            />
            <MenuContent align="end">
              <MenuItem
                icon={<RefreshCw className="h-3.5 w-3.5" />}
                disabled={snapshotLoading}
                onClick={() => onExecute(panel)}
              >
                Refresh
              </MenuItem>
              <MenuItem
                icon={<Bell className="h-3.5 w-3.5" />}
                onClick={() => onConfigureAlert(panel)}
              >
                Configure alert
              </MenuItem>
              <MenuItem icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => onEdit(panel)}>
                Edit script
              </MenuItem>
              <MenuItem
                destructive
                icon={<Trash2 className="h-3.5 w-3.5" />}
                onClick={() => onDelete(panel)}
              >
                Delete panel
              </MenuItem>
            </MenuContent>
          </Menu>
          {panel.currentSnapshot?.status === 'failed' && (
            <button
              type="button"
              title="View error log"
              aria-label={`View error log for ${panel.title}`}
              onClick={() => setErrorOpen(true)}
              className="rounded p-1 text-orange-400 outline-none transition-colors hover:bg-orange-400/10 hover:text-orange-300 focus-visible:ring-1 focus-visible:ring-orange-400/50"
            >
              <AlertTriangle className="h-4 w-4" />
            </button>
          )}
          {snapshotLoading && (
            <div className="h-3 w-3 animate-spin rounded-full border-2 border-zGray-700 border-t-zViolet-accent" />
          )}
        </div>
        <div
          className={`px-3 py-2 transition-opacity duration-200 ${snapshotLoading && hasStaleOutput ? 'opacity-40' : 'opacity-100'}`}
        >
          <Body panel={panel} lastSuccessfulOutput={lastSuccessful?.output ?? null} />
        </div>
        {panel.currentSnapshot?.status === 'failed' && (
          <ScriptErrorModal
            open={errorOpen}
            panel={panel}
            snapshot={panel.currentSnapshot}
            onClose={() => setErrorOpen(false)}
          />
        )}
      </div>
    )
  },
)

PanelCard.displayName = 'PanelCard'
