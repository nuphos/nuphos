import { clsx } from 'clsx'
import { useCallback, useEffect, useState } from 'react'

import { readLocalStorage, writeLocalStorage } from '../localStorage'

import { paneRects, removePane, splitPane } from './splitLayout'
import { createWorkspaceState, selectAllResidentTabs, selectScope } from './store/workspaceState'
import { WorkspacePaneContext } from './WorkspacePaneContext'

import type { SplitLayout } from './splitLayout'
import type { WorkspaceState } from './store/workspaceState'
import type { WorkspaceStore } from './store/workspaceStore'
import type { WorkspaceProps } from './workspaceProps'
import type { ComponentType } from 'react'

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
  const [activeId, setActiveId] = useState('primary')
  const [sidebarHost, setSidebarHost] = useState<HTMLDivElement | null>(null)
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
    [activeId, focusSurfaces, stores],
  )
  const split = useCallback(
    (direction: 'row' | 'column') => {
      const current = stores.get(activeId)?.getState()

      if (!current?.teamsKnown || !current.teamScope) return
      const id = crypto.randomUUID()

      seeds.set(id, { ...createWorkspaceState(), teamScope: current.teamScope, teamsKnown: true })
      setLayout((value) => splitPane(value, activeId, id, direction))
      setActiveId(id)
    },
    [activeId, seeds, stores],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.code !== 'KeyD' ||
        event.isComposing
      )
        return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (!event.repeat) split(event.shiftKey ? 'column' : 'row')
    }

    window.addEventListener('keydown', onKeyDown, true)

    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [split])

  useEffect(() => {
    const focusOwner = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return
      const owner = target.closest<HTMLElement>('[data-workspace-split-pane]')

      const id = owner?.dataset.workspaceSplitPane

      if (!id) return
      const surface = target.closest<HTMLElement>('[data-workspace-focus-surface]')?.dataset
        .workspaceFocusSurface

      if (surface) focusSurfaces.set(id, surface)
      setActiveId(id)
    }
    const onPointerDown = (event: PointerEvent) => focusOwner(event.composedPath()[0])
    const onFocus = (event: FocusEvent) => focusOwner(event.target)
    // A webview/iframe owns a separate document: its pointer events do not
    // bubble through React. Chromium exposes the guest host as activeElement.
    let frame = 0
    const onBlur = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => focusOwner(document.activeElement))
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('focus', onFocus, true)
    window.addEventListener('blur', onBlur)

    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('focus', onFocus, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [focusSurfaces])

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
      <div ref={setSidebarHost} className="flex shrink-0" />
      <div className="relative min-w-0 flex-1">
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

          return (
            <WorkspacePaneContext.Provider
              key={rect.id}
              value={{
                focusSession,
                sidebarCollapsed,
                toggleSidebarCollapsed,
                isTabFocused: () => focusSurfaces.get(rect.id) === 'tab',
                closePane: () => close(rect.id),
                active: activeId === rect.id,
                // The first surviving leaf owns persistence, even after the original closes.
                primary: rect.id === rects[0].id,
                sidebarHost,
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
                  'absolute flex min-h-0 min-w-0 flex-col overflow-hidden',
                  multiple && 'border border-zGray-800/60',
                  activeId !== rect.id && 'opacity-50',
                )}
                style={{
                  left: `${String(rect.left)}%`,
                  top: `${String(rect.top)}%`,
                  width: `${String(rect.width)}%`,
                  height: `${String(rect.height)}%`,
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
      </div>
    </div>
  )
}
