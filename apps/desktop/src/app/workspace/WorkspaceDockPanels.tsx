import { clsx } from 'clsx'
import { PanelRight } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { t } from '../../i18n'
import { comboText } from '../../lib/platform'

import { cycleFocusRegion, moveFocusWithDock } from './dockFocus'
import { WorkspaceMainPane } from './WorkspaceMainPane'
import { useWorkspacePane } from './WorkspacePaneContext'
import { WorkspaceTabStrip } from './WorkspaceTabStrip'

import type { WorkspaceController } from './useWorkspaceController'
import type { UserInfo } from '../../types'

/**
 * The column beside the chat. A management page takes this column over rather
 * than replacing it, so the panes it holds stay mounted: a browser tab's state
 * is its webview, and unmounting one reloads the page (see usePaneOrder). For a
 * management page only the column's width and sheet change, along with the
 * dock's own chrome, which the page has no use for.
 */
export function WorkspaceDockPanels({ ws, user }: { ws: WorkspaceController; user: UserInfo }) {
  const {
    dockOpen,
    mainPageOpen,
    workspaceActions,
    workspaceDockExpanded,
    setWorkspaceDockExpanded,
    scope,
  } = ws
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
  // The chat column beside the dock lays out at its settled width from this.
  useLayoutEffect(() => {
    dockRef.current?.parentElement?.style.setProperty(
      '--workspace-dock-width',
      `${String(widthVw)}cqw`,
    )
  }, [widthVw, scope?.teamId])

  useEffect(() => {
    // Expanded is the dock's own state, so a management page must not clear it.
    if (!mainPageOpen && !dockOpen) setWorkspaceDockExpanded(false)
  }, [dockOpen, mainPageOpen, setWorkspaceDockExpanded])

  // ⌘J opens or closes the dock, taking the caret along. ⇧⌘↩ expands or
  // restores it; from closed it opens straight to expanded.
  const paneActive = useWorkspacePane()?.active ?? true
  // The dock's own keys: a management page is the full-width surface instead.
  const dockKeysLive = !mainPageOpen && paneActive && Boolean(scope?.teamId)

  useEffect(() => {
    if (!dockKeysLive || typeof window.api.onAppShortcut !== 'function') return

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
  }, [dockKeysLive, dockOpen, workspaceActions, setWorkspaceDockExpanded, ws.chatShortcutsLive])

  // The dock column is a sheet; its margins come off the width it is given. Beside the
  // session it shares the gap (half an inset); expanded, it has the desk to itself.
  const contentWidth = contentFollowsAside ? '100%' : `${String(widthVw)}cqw`
  const insets = workspaceDockExpanded ? 2 : 1.5
  const dockWidth = dockOpen ? (workspaceDockExpanded ? '100%' : `${String(widthVw)}cqw`) : 0
  // A management page fills the column itself, at whatever width the row gives it.
  // `auto` is not a length, so switching to or from one is not a width animation.
  const columnWidth = mainPageOpen ? 'auto' : dockWidth
  // The page is its own sheet, with its own margins, so this wrapper stays flat.
  const contentStyle = mainPageOpen
    ? undefined
    : { width: `calc(${contentWidth} - ${String(insets)} * var(--sheet-inset))` }

  return (
    <>
      {scope?.teamId && (
        <aside
          data-workspace-focus-surface="tab"
          // A management page fills this column, so its title bar keeps its
          // window-drag region — the opposite of a collapsed dock's clipped one.
          data-dock-open={mainPageOpen || dockOpen}
          // Not a landmark beside the page: while a management page is open, the
          // page is what the column holds.
          role={mainPageOpen ? 'none' : undefined}
          ref={dockRef}
          onTransitionEnd={(event) => {
            if (event.target === event.currentTarget && event.propertyName === 'width') {
              setSettledExpanded(workspaceDockExpanded)
            }
          }}
          style={{ width: columnWidth }}
          className={clsx(
            'relative flex min-h-0 flex-col overflow-hidden',
            // A management page takes the row's leftover width, as the main pane
            // did; the dock itself keeps its own width.
            mainPageOpen ? 'flex-1' : 'flex-shrink-0',
            !dragging && 'transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
          )}
        >
          {!mainPageOpen && dockOpen && !workspaceDockExpanded && (
            <div
              onMouseDown={() => setDragging(true)}
              className="group absolute bottom-0 left-0 top-0 z-20 w-2 cursor-col-resize"
            >
              <div
                className={clsx(
                  'h-full w-1 transition-colors',
                  dragging ? 'bg-action-primary/30' : 'group-hover:bg-state-hover',
                )}
              />
            </div>
          )}
          <div
            style={contentStyle}
            className={clsx(
              'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
              !mainPageOpen && 'workspace-content-surface',
              !mainPageOpen && !workspaceDockExpanded && 'workspace-content-surface--trailing',
            )}
          >
            {!mainPageOpen && <WorkspaceTabStrip ws={ws} userId={user.id} />}
            <WorkspaceMainPane ws={ws} user={user} />
          </div>
        </aside>
      )}
      {scope?.teamId && !mainPageOpen && (
        <button
          type="button"
          onClick={() => workspaceActions.toggleDock()}
          className={clsx(
            'workspace-dock-toggle titlebar-no-drag flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-state-hover hover:text-main',
            dockOpen ? 'bg-state-selected text-main' : 'text-secondary',
          )}
          title={`${dockOpen ? t('Close workspace panel') : t('Open workspace panel')} (${comboText('mod+j')})`}
          aria-label={dockOpen ? t('Close workspace panel') : t('Open workspace panel')}
          aria-pressed={dockOpen}
        >
          <PanelRight className="h-4 w-4" strokeWidth={1.7} />
        </button>
      )}
    </>
  )
}
