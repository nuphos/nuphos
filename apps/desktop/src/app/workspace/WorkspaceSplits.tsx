import { clsx } from 'clsx'
import { useCallback, useEffect, useRef, useState } from 'react'

import { isMac } from '../../lib/platform'
import { readLocalStorage, writeLocalStorage } from '../localStorage'

import { createSidebarSlot } from './sidebarSlot'
import { SidebarSlotHost } from './SidebarSlotHost'
import { SplitDropOverlay } from './SplitDropOverlay'
import {
  dropPane,
  focusPaneState,
  isSplitShortcut,
  paneRects,
  removePane,
  reusableBesidePane,
} from './splitLayout'
import {
  createWorkspaceState,
  selectAllResidentTabs,
  selectScope,
  teamScopeOf,
} from './store/workspaceState'
import { usePaneCloseConfirm } from './usePaneCloseConfirm'
import { GLIDE, usePaneDropPreview } from './usePaneDropPreview'
import { usePaneFocusTracking } from './usePaneFocusTracking'
import { WorkspacePaneContext } from './WorkspacePaneContext'

import type { DropZone, SplitLayout } from './splitLayout'
import type { WorkspaceState } from './store/workspaceState'
import type { WorkspaceStore } from './store/workspaceStore'
import type { WorkspaceProps } from './workspaceProps'
import type { ComponentType, SetStateAction } from 'react'

export function WorkspaceSplits({
  Pane,
  onLogout,
  ...props
}: WorkspaceProps & { Pane: ComponentType<WorkspaceProps> }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => readLocalStorage('nuphos.sidebarCollapsed') === '1',
  )
  const toggleSidebarCollapsed = useCallback(() => setSidebarCollapsed((value) => !value), [])

  useEffect(() => {
    writeLocalStorage('nuphos.sidebarCollapsed', sidebarCollapsed ? '1' : '0')
  }, [sidebarCollapsed])

  const [layout, setLayout] = useState<SplitLayout>({ id: 'primary' })
  const { placed, gliding, onPreview } = usePaneDropPreview(layout)
  const [{ activeId, sessionSearchOpen }, setWindowState] = useState({
    activeId: 'primary',
    sessionSearchOpen: false,
  })
  const setActiveId = useCallback((id: string) => {
    setWindowState((previous) => focusPaneState(previous, id))
  }, [])
  const setSessionSearchOpen = useCallback((open: SetStateAction<boolean>) => {
    setWindowState((previous) => ({
      ...previous,
      sessionSearchOpen: typeof open === 'function' ? open(previous.sessionSearchOpen) : open,
    }))
  }, [])
  const [sidebar] = useState(createSidebarSlot)
  const [focusSurfaces] = useState(() => new Map<string, string>())
  const [stores] = useState(() => new Map<string, WorkspaceStore>())
  const [seeds] = useState(() => new Map<string, WorkspaceState>())
  const [registrations] = useState(() => new Map<string, (store: WorkspaceStore) => () => void>())
  const focusSession = useCallback(
    (sessionId: string, teamId?: string) => {
      // Prefer the focused pane if an older layout already contains duplicates.
      const candidates = [activeId, ...stores.keys()].filter(
        (id, index, ids) => ids.indexOf(id) === index,
      )

      for (const id of candidates) {
        const state = stores.get(id)?.getState()

        if (!state || state.mainPageOpen || state.sessionId !== sessionId) continue
        if (teamId && selectScope(state)?.teamId !== teamId) continue
        focusSurfaces.set(id, 'session')
        setActiveId(id)

        return true
      }

      return false
    },
    [activeId, focusSurfaces, stores, setActiveId],
  )
  const split = useCallback(
    (
      side: Exclude<DropZone, 'center'>,
      from = activeId,
      seed?: { sessionId: string; teamId?: string },
    ) => {
      const current = stores.get(from)?.getState()

      if (!current?.teamsKnown || !current.teamScope) return null
      const id = crypto.randomUUID()
      const teamScope =
        seed?.teamId && seed.teamId !== current.teamScope.teamId
          ? teamScopeOf(seed.teamId)
          : current.teamScope

      seeds.set(id, {
        ...createWorkspaceState(),
        teamScope,
        teamsKnown: true,
        sessionId: seed?.sessionId ?? null,
      })
      setLayout((value) => dropPane(value, from, id, side))
      setActiveId(id)

      return id
    },
    [activeId, seeds, stores, setActiveId],
  )
  // ⌘-click on a session link: focus it where it is already open, else show it
  // in the pane the last ⌘-click filled, else split one off to the right.
  const beside = useRef<{ pane: string; sessionId: string } | null>(null)
  const openSessionBeside = useCallback(
    (source: string, sessionId: string, teamId?: string) => {
      if (focusSession(sessionId, teamId)) return true
      let pane = reusableBesidePane(beside.current, source, (id) => {
        const state = stores.get(id)?.getState()

        return state && !state.mainPageOpen ? state.sessionId : null
      })

      if (pane) stores.get(pane)?.actions.selectSession(sessionId, { teamId })
      else pane = split('right', source, { sessionId, teamId })
      if (!pane) return false
      focusSurfaces.set(pane, 'session')
      setActiveId(pane)
      beside.current = { pane, sessionId }

      return true
    },
    [focusSession, focusSurfaces, split, stores, setActiveId],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isSplitShortcut(event, isMac)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (!event.repeat) split(event.shiftKey ? 'bottom' : 'right')
    }

    window.addEventListener('keydown', onKeyDown, true)

    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [split])

  usePaneFocusTracking(focusSurfaces, setActiveId)

  const rects = paneRects(layout)
  const multiple = rects.length > 1

  const close = (id: string) => {
    const next = removePane(layout, id)

    const store = stores.get(id)

    // Keep the app usable when closing the final session: return to a blank chat.
    if (!next) {
      store?.actions.selectSession(null)
      store?.actions.setDockOpen(false)

      return
    }

    if (store) {
      // Dispatch before unmount so the existing teardown observer also handles
      // terminals whose asynchronous creation has not finished yet.
      for (const tab of selectAllResidentTabs(store.getState())) store.actions.closeTab(tab.id)
    }
    setLayout(next)
    if (activeId === id) setActiveId(paneRects(next)[0].id)
    focusSurfaces.delete(id)
    seeds.delete(id)
    registrations.delete(id)
  }

  const closing = usePaneCloseConfirm(stores, multiple, close)

  const handleLogout = useCallback(async () => {
    // Other panes stay mounted until logout completes; release their terminals too.
    for (const store of stores.values()) {
      for (const tab of selectAllResidentTabs(store.getState())) {
        if (tab.sshTerminal) store.actions.closeTab(tab.id)
      }
    }
    await onLogout()
  }, [onLogout, stores])

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <div className="flex shrink-0">
        <SidebarSlotHost slot={sidebar} />
      </div>
      <div className="relative min-w-0 flex-1 bg-main">
        {/* Flat keyed leaves stay mounted even when the split tree changes shape. */}
        {rects.map((rect) => {
          let registerStore = registrations.get(rect.id)

          if (!registerStore) {
            registerStore = (store) => {
              stores.set(rect.id, store)

              return () => {
                stores.delete(rect.id)
              }
            }
            registrations.set(rect.id, registerStore)
          }

          const at = placed.get(rect.id) ?? rect

          return (
            <WorkspacePaneContext.Provider
              key={rect.id}
              value={{
                paneId,
                sessionSearchOpen,
                setSessionSearchOpen,
                focusSession,
                openSessionBeside: (sessionId, teamId) =>
                  openSessionBeside(rect.id, sessionId, teamId),
                sidebarCollapsed,
                toggleSidebarCollapsed,
                isTabFocused: () => focusSurfaces.get(rect.id) === 'tab',
                closePane: () => closing.request(rect.id),
                split: multiple,
                active: activeId === rect.id,
                // The first surviving leaf owns persistence, even after the original closes.
                primary: rect.id === rects[0].id,
                sidebar,
                initialState: seeds.get(rect.id),
                registerStore,
              }}
            >
              <section
                data-workspace-split-pane={rect.id}
                data-pane-active={activeId === rect.id ? 'true' : 'false'}
                data-traffic-light-inset={
                  sidebarCollapsed && rect.left === 0 && rect.top === 0 ? 'true' : undefined
                }
                data-split-multiple={multiple ? 'true' : undefined}
                className={clsx(
                  'group/pane absolute flex min-h-0 min-w-0 flex-col overflow-hidden',
                  multiple && 'border border-zGray-800/60',
                  activeId !== rect.id && 'opacity-50',
                  // Panes slide over the split area's own background, so crossing panes leave no gaps.
                  gliding && [
                    'bg-main transition-[left,top,width,height] will-change-[left,top,width,height]',
                    GLIDE,
                  ],
                )}
                style={{
                  left: `${String(at.left)}%`,
                  top: `${String(at.top)}%`,
                  width: `${String(at.width)}%`,
                  height: `${String(at.height)}%`,
                }}
                onPointerDownCapture={() => setActiveId(rect.id)}
                onFocusCapture={() => setActiveId(rect.id)}
              >
                <div
                  className="relative min-h-0 flex-1 overflow-hidden"
                  style={{ containerType: 'inline-size' }}
                >
                  <Pane {...props} onLogout={handleLogout} />
                </div>
              </section>
            </WorkspacePaneContext.Provider>
          )
        })}
        {closing.dialog}
        <SplitDropOverlay
          rects={rects}
          placed={placed}
          onPreview={onPreview}
          stores={stores}
          split={split}
          place={(target, id, zone) => {
            setLayout((value) => dropPane(value, target, id, zone))
            focusSurfaces.set(id, 'session')
            setActiveId(id)
          }}
        />
      </div>
    </div>
  )
}
