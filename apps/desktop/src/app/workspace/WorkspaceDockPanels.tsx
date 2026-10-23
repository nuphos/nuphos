import { clsx } from 'clsx'
import { Maximize2, Minimize2, PanelRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Kbd } from '../../components/ui/kbd'
import { Tooltip } from '../../components/ui/tooltip'
import { comboText } from '../../lib/platform'

import { cycleFocusRegion, moveFocusWithDock } from './dockFocus'
import { WorkspaceMainPane } from './WorkspaceMainPane'
import { useWorkspacePane } from './WorkspacePaneContext'
import { WorkspaceTabStrip } from './WorkspaceTabStrip'

import type { WorkspaceController } from './useWorkspaceController'
import type { UserInfo } from '../../types'

export function WorkspaceDockPanels({ ws, user }: { ws: WorkspaceController; user: UserInfo }) {
  const { dockOpen, workspaceActions, workspaceDockExpanded, setWorkspaceDockExpanded, scope } = ws
  const dockRef = useRef<HTMLElement | null>(null)
  const [widthVw, setWidthVw] = useState(() => {
    const stored = Number(localStorage.getItem('nuphos.workspaceDockWidthVw'))

    return Number.isFinite(stored) && stored > 0 ? Math.min(60, Math.max(24, stored)) : 42
  })
  const [dragging, setDragging] = useState(false)
  // Expanded as of the last finished width transition. While the dock animates
  // back from full width its content follows the aside's width; snapping it to
  // the docked width at once left a blank band beside it until the aside caught up.
  const [settledExpanded, setSettledExpanded] = useState(workspaceDockExpanded)
  const contentFollowsAside = dockOpen && (workspaceDockExpanded || settledExpanded)

  useEffect(() => {
    if (!dragging) return
    const move = (event: MouseEvent) => {
      const bounds = dockRef.current?.parentElement?.getBoundingClientRect()

      if (!bounds?.width) return
      const next = ((bounds.right - event.clientX) / bounds.width) * 100

      setWidthVw(Math.min(60, Math.max(24, next)))
    }
    const up = () => setDragging(false)

    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)

    return () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
    }
  }, [dragging])

  useEffect(() => localStorage.setItem('nuphos.workspaceDockWidthVw', String(widthVw)), [widthVw])

  useEffect(() => {
    if (!dockOpen) setWorkspaceDockExpanded(false)
  }, [dockOpen, setWorkspaceDockExpanded])

  // ⌘J opens or closes the dock, taking the caret along. ⇧⌘↩ expands or
  // restores it; from closed it opens straight to expanded.
  const paneActive = useWorkspacePane()?.active ?? true

  useEffect(() => {
    if (!paneActive || !scope?.teamId || typeof window.api.onAppShortcut !== 'function') return

    return window.api.onAppShortcut((action) => {
      if (action === 'focus-next-region' || action === 'focus-previous-region') {
        // Not behind Settings or a takeover, the gate the chat's own keys use.
        if (ws.chatShortcutsLive) {
          cycleFocusRegion(dockRef.current, dockOpen, action === 'focus-next-region' ? 1 : -1)
        }

        return
      }
      if (action === 'toggle-dock') {
        workspaceActions.toggleDock()
        window.requestAnimationFrame(() => moveFocusWithDock(dockRef.current, !dockOpen))

        return
      }
      if (action !== 'toggle-dock-expanded') return
      if (dockOpen) {
        setWorkspaceDockExpanded((expanded) => !expanded)

        return
      }
      workspaceActions.setDockOpen(true)
      setWorkspaceDockExpanded(true)
    })
  }, [
    paneActive,
    scope?.teamId,
    dockOpen,
    workspaceActions,
    setWorkspaceDockExpanded,
    ws.chatShortcutsLive,
  ])

  return (
    <>
      {scope?.teamId && (
        <aside
          data-workspace-focus-surface="tab"
          data-dock-open={dockOpen}
          ref={dockRef}
          onTransitionEnd={(event) => {
            if (event.target === event.currentTarget && event.propertyName === 'width') {
              setSettledExpanded(workspaceDockExpanded)
            }
          }}
          style={{
            width: dockOpen ? (workspaceDockExpanded ? '100%' : `${String(widthVw)}cqw`) : 0,
          }}
          className={clsx(
            'relative flex min-h-0 flex-shrink-0 flex-col overflow-hidden sidebar-surface',
            dockOpen && !workspaceDockExpanded && 'border-l border-zGray-800/60',
            !dragging && 'transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
          )}
        >
          {dockOpen && !workspaceDockExpanded && (
            <div
              onMouseDown={() => setDragging(true)}
              className="group absolute bottom-0 left-0 top-0 z-20 w-2 cursor-col-resize"
            >
              <div
                className={clsx(
                  'h-full w-1 transition-colors',
                  dragging ? 'bg-zViolet-500/30' : 'group-hover:bg-zGray-800/60',
                )}
              />
            </div>
          )}
          <div
            style={{ width: contentFollowsAside ? '100%' : `${String(widthVw)}cqw` }}
            className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
          >
            <WorkspaceTabStrip ws={ws} userId={user.id} />
            <WorkspaceMainPane ws={ws} user={user} />
          </div>
        </aside>
      )}
      {scope?.teamId && dockOpen && (
        // The span carries the fixed titlebar position so the tooltip anchors to
        // the button rather than to where the button would sit in the flow.
        <span className="workspace-dock-expand titlebar-no-drag">
          <Tooltip
            side="bottom"
            content={
              <span className="flex items-center gap-2">
                {workspaceDockExpanded ? 'Restore workspace panel' : 'Expand workspace panel'}
                <Kbd combo="mod+shift+enter" />
              </span>
            }
          >
            <button
              type="button"
              onClick={() => setWorkspaceDockExpanded((expanded) => !expanded)}
              className={clsx(
                'flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-zGray-800/60 hover:text-main',
                workspaceDockExpanded ? 'bg-zGray-800/60 text-main' : 'text-secondary',
              )}
              aria-label={
                workspaceDockExpanded ? 'Restore workspace panel' : 'Expand workspace panel'
              }
              aria-pressed={workspaceDockExpanded}
            >
              {workspaceDockExpanded ? (
                <Minimize2 className="h-4 w-4" strokeWidth={1.7} />
              ) : (
                <Maximize2 className="h-4 w-4" strokeWidth={1.7} />
              )}
            </button>
          </Tooltip>
        </span>
      )}
      {scope?.teamId && (
        <button
          type="button"
          onClick={() => workspaceActions.toggleDock()}
          className={clsx(
            'workspace-dock-toggle titlebar-no-drag flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-zGray-800/60 hover:text-main',
            dockOpen ? 'bg-zGray-800/60 text-main' : 'text-secondary',
          )}
          title={`${dockOpen ? 'Close workspace panel' : 'Open workspace panel'} (${comboText('mod+j')})`}
          aria-label={dockOpen ? 'Close workspace panel' : 'Open workspace panel'}
          aria-pressed={dockOpen}
        >
          <PanelRight className="h-4 w-4" strokeWidth={1.7} />
        </button>
      )}
    </>
  )
}
