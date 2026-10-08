import { clsx } from 'clsx'
import { Maximize2, Minimize2, PanelRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { FirstRunPanel } from '../../views/onboarding/FirstRunPanel'

import { WorkspaceMainPane } from './WorkspaceMainPane'
import { useWorkspacePane } from './WorkspacePaneContext'
import { WorkspaceTabStrip } from './WorkspaceTabStrip'

import type { WorkspaceController } from './useWorkspaceController'
import type { UserInfo } from '../../types'

export function WorkspaceDockPanels({ ws, user }: { ws: WorkspaceController; user: UserInfo }) {
  const {
    dockOpen,
    workspaceActions,
    firstRunPanelOpen,
    setFirstRunPanelOpen,
    workspaceDockExpanded,
    setWorkspaceDockExpanded,
    activeTab,
    scope,
    enterScope,
    updateTab,
  } = ws
  const dockRef = useRef<HTMLElement | null>(null)
  const [widthVw, setWidthVw] = useState(() => {
    const stored = Number(localStorage.getItem('nuphos.workspaceDockWidthVw'))

    return Number.isFinite(stored) && stored > 0 ? Math.min(60, Math.max(24, stored)) : 42
  })
  const [dragging, setDragging] = useState(false)
  const [suppressDockTransition, setSuppressDockTransition] = useState(false)

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

  // ⇧⌘↩ — expand or restore the dock; from closed it opens straight to expanded.
  const paneActive = useWorkspacePane()?.active ?? true

  useEffect(() => {
    if (!paneActive || !scope?.teamId || typeof window.api.onAppShortcut !== 'function') return

    return window.api.onAppShortcut((action) => {
      if (action !== 'toggle-dock-expanded') return
      setSuppressDockTransition(true)
      if (dockOpen) {
        setWorkspaceDockExpanded((expanded) => !expanded)

        return
      }
      workspaceActions.setDockOpen(true)
      setWorkspaceDockExpanded(true)
    })
  }, [paneActive, scope?.teamId, dockOpen, workspaceActions, setWorkspaceDockExpanded])

  useEffect(() => {
    if (!suppressDockTransition) return
    const frame = window.requestAnimationFrame(() => setSuppressDockTransition(false))

    return () => window.cancelAnimationFrame(frame)
  }, [suppressDockTransition])

  return (
    <>
      {scope?.teamId && (
        <aside
          data-workspace-focus-surface="tab"
          ref={dockRef}
          style={{
            width: dockOpen ? (workspaceDockExpanded ? '100%' : `${String(widthVw)}cqw`) : 0,
          }}
          className={clsx(
            'relative flex min-h-0 flex-shrink-0 flex-col overflow-hidden sidebar-surface',
            dockOpen && !workspaceDockExpanded && 'border-l border-zGray-800/60',
            !dragging &&
              !suppressDockTransition &&
              'transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
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
            style={{ width: workspaceDockExpanded ? '100%' : `${String(widthVw)}cqw` }}
            className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
          >
            <WorkspaceTabStrip ws={ws} userId={user.id} />
            <WorkspaceMainPane ws={ws} user={user} />
          </div>
        </aside>
      )}
      {scope?.teamId && dockOpen && (
        <button
          type="button"
          onClick={() => {
            // Fullscreen changes both columns at once. Animating only the
            // dock's width made the Agent disappear first and left a growing
            // blank gap; commit this mode switch as one clean frame instead.
            setSuppressDockTransition(true)
            setWorkspaceDockExpanded((expanded) => !expanded)
          }}
          className={clsx(
            'workspace-dock-expand titlebar-no-drag flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-zGray-800/60 hover:text-main',
            workspaceDockExpanded ? 'bg-zGray-800/60 text-main' : 'text-secondary',
          )}
          title={workspaceDockExpanded ? 'Restore workspace panel' : 'Expand workspace panel'}
          aria-label={workspaceDockExpanded ? 'Restore workspace panel' : 'Expand workspace panel'}
          aria-pressed={workspaceDockExpanded}
        >
          {workspaceDockExpanded ? (
            <Minimize2 className="h-4 w-4" strokeWidth={1.7} />
          ) : (
            <Maximize2 className="h-4 w-4" strokeWidth={1.7} />
          )}
        </button>
      )}
      {scope?.teamId && (
        <button
          type="button"
          onClick={() => {
            setFirstRunPanelOpen(false)
            if (dockOpen && workspaceDockExpanded) {
              setSuppressDockTransition(true)
              setWorkspaceDockExpanded(false)
            }
            workspaceActions.toggleDock()
          }}
          className={clsx(
            'workspace-dock-toggle titlebar-no-drag flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-zGray-800/60 hover:text-main',
            dockOpen ? 'bg-zGray-800/60 text-main' : 'text-secondary',
          )}
          title={dockOpen ? 'Close workspace panel' : 'Open workspace panel'}
          aria-label={dockOpen ? 'Close workspace panel' : 'Open workspace panel'}
          aria-pressed={dockOpen}
        >
          <PanelRight className="h-4 w-4" strokeWidth={1.7} />
        </button>
      )}
      {scope?.teamId && (
        <FirstRunPanel
          open={firstRunPanelOpen}
          onOpenAgentChat={ws.stableOpenAgentChatWithPrompt}
          teamId={scope.teamId}
          onClose={() => setFirstRunPanelOpen(false)}
          onBound={() => {
            // Same move every other bind dialog makes: bump the tab's refresh
            // key so the team's accounts reload.
            if (activeTab) {
              updateTab(activeTab.id, (tab) => ({ ...tab, refreshKey: tab.refreshKey + 1 }))
            }
          }}
          onOpenAgentPage={() => {
            const targetTeamId = scope?.teamId

            if (targetTeamId) enterScope({ kind: 'team', teamId: targetTeamId }, 'team.agent')
          }}
          onDone={() => setFirstRunPanelOpen(false)}
        />
      )}
    </>
  )
}
