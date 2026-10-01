import { faPlus } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useCallback, useEffect, useRef, useState } from 'react'

import { SidebarToggleButton } from '../../../components/Sidebar'
import { Kbd } from '../../../components/ui/kbd'
import { Tooltip } from '../../../components/ui/tooltip'
import { logNewTabRequested, logTabActivated } from '../../../lib/tabSwitchLog'
import { isPermanentSidebarPage } from '../../navItems'

import { TabStripActions } from './TabStripActions'
import { useTabDragEvents } from './useTabDragEvents'
import { useTabDragPreview } from './useTabDragPreview'
import { useTabStripFavorites } from './useTabStripFavorites'
import { WorkspaceTabItem } from './WorkspaceTabItem'
import { WorkspaceTabsContextMenu } from './WorkspaceTabsContextMenu'

import type { TabContextMenuState, WorkspaceTabsProps } from './tabsTypes'
import type { TabDropTarget } from './useTabDragPreview'

export function WorkspaceTabs({
  userId,
  tabs,
  activeTabId,
  accounts,
  databaseConnectionsByTeam,
  onSelect,
  onNew,
  onClose,
  onDuplicate,
  onCloseOthers,
  onReorder,
  onCopyPageUrl,
  sidebarCollapsed,
  onToggleSidebarCollapse,
  firstRunConnectAvailable,
  onStartFirstRunConnect,
}: WorkspaceTabsProps) {
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<TabDropTarget>(null)
  const [dragOffsetX, setDragOffsetX] = useState(0)
  const [dragSlotWidth, setDragSlotWidth] = useState(0)
  const [tabDropSettling, setTabDropSettling] = useState(false)
  const [tabContextMenu, setTabContextMenu] = useState<TabContextMenuState | null>(null)

  // Keep the close affordance on the final tab too. It deliberately calls the
  // same closeTab action as Cmd+W, whose single-tab branch replaces the tab
  // with a fresh one and closes the right-hand workspace panel.
  const showClose = tabs.length > 0

  const favoriteTeamKey = Array.from(new Set(tabs.map((tab) => tab.scope.teamId)))
    .sort((a, b) => a.localeCompare(b))
    .join('\0')
  const { isFavorited, toggleFavorite } = useTabStripFavorites(userId, favoriteTeamKey)

  // Tabs share the available strip width before the strip scrolls. Reveal the
  // active tab whenever it changes; if the active tab is the last tab, keep the
  // new-tab button visible beside it too.
  const tabRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const newTabButtonRef = useRef<HTMLButtonElement | null>(null)

  const lastTabId = tabs.at(-1)?.id

  useEffect(() => {
    if (!activeTabId) return
    const activeTabEl = tabRefs.current.get(activeTabId)
    const targetEl = activeTabId === lastTabId ? newTabButtonRef.current : activeTabEl

    targetEl?.scrollIntoView({
      behavior: 'auto',
      inline: 'nearest',
      block: 'nearest',
    })
  }, [activeTabId, lastTabId, tabs.length])
  useEffect(() => {
    if (activeTabId) logTabActivated(activeTabId)
  }, [activeTabId])

  const {
    clearTabDragState,
    dropTargetRef,
    tabDropSettlingFrameRef,
    tabPointerDragRef,
    suppressTabClickRef,
    resolveTabDropTarget,
    tabPreviewOffsets,
  } = useTabDragPreview({
    tabs,
    tabRefs,
    draggingTabId,
    dropTarget,
    dragSlotWidth,
    setDraggingTabId,
    setDropTarget,
    setDragOffsetX,
    setDragSlotWidth,
  })

  const { handleTabPointerDown, handleTabMouseDown } = useTabDragEvents({
    onSelect,
    onReorder,
    tabRefs,
    setDraggingTabId,
    setDragOffsetX,
    setDragSlotWidth,
    setDropTarget,
    setTabDropSettling,
    resolveTabDropTarget,
    dropTargetRef,
    tabPointerDragRef,
    suppressTabClickRef,
    tabDropSettlingFrameRef,
    clearTabDragState,
  })

  // Close immediately. The old two-phase path selected a fallback, rendered
  // every pane, waited for a 120 ms animation, then removed the tab and
  // rendered them all again. Heavy pages made that cosmetic delay much worse.
  const handleClose = useCallback((id: string) => onClose(id), [onClose])

  const contextMenuCanFavorite = tabContextMenu
    ? !isPermanentSidebarPage(tabContextMenu.appHref)
    : false
  const contextMenuFavorited =
    contextMenuCanFavorite && tabContextMenu
      ? isFavorited(tabContextMenu.teamId, tabContextMenu.appHref)
      : false

  return (
    // Keep the native 44px titlebar geometry while a 30px tab leaves only 7px
    // above and below. This preserves the traffic-light/caption-button alignment
    // (`trafficLightPositionFor` in electron/main/windows.ts) and where the
    // sidebar header puts its own controls. A `pt-1` here pushed the tabs —
    // and the sidebar toggle that reappears beside them once the sidebar is
    // collapsed — 2px below all three.
    <div className="workspace-dock-toggle-pad bg-main h-[44px] flex-shrink-0 flex items-center gap-0.5 titlebar-caption-pad titlebar-drag">
      {sidebarCollapsed && onToggleSidebarCollapse && (
        // Mirror the sidebar's titlebar button once the sidebar is hidden. On
        // macOS the leading margin clears the traffic lights it now sits beside;
        // off macOS there are none, so it sits flush left.
        <SidebarToggleButton
          collapsed
          onClick={onToggleSidebarCollapse}
          className="titlebar-lead-ml mr-0.5 flex-shrink-0"
        />
      )}
      <div
        className="t-tab-strip flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto overflow-y-hidden pl-2 scrollbar-none"
        data-drop-settling={tabDropSettling ? 'true' : undefined}
      >
        {tabs.map((tab) => (
          <WorkspaceTabItem
            key={tab.id}
            tab={tab}
            accounts={accounts}
            databaseConnections={databaseConnectionsByTeam[tab.scope.teamId] ?? []}
            selected={tab.id === activeTabId}
            showClose={showClose}
            dragging={draggingTabId === tab.id}
            dragOffsetX={dragOffsetX}
            previewOffset={tabPreviewOffsets.get(tab.id)}
            isFavorited={isFavorited}
            toggleFavorite={toggleFavorite}
            handleClose={handleClose}
            handleTabPointerDown={handleTabPointerDown}
            handleTabMouseDown={handleTabMouseDown}
            clearTabDragState={clearTabDragState}
            onSelect={onSelect}
            tabRefs={tabRefs}
            tabPointerDragRef={tabPointerDragRef}
            suppressTabClickRef={suppressTabClickRef}
            setTabContextMenu={setTabContextMenu}
          />
        ))}
        <Tooltip
          content={
            <span className="inline-flex items-center gap-1.5">
              New tab <Kbd combo="mod+t" />
            </span>
          }
        >
          <button
            ref={newTabButtonRef}
            onPointerDown={(event) => {
              if (event.button !== 0) return
              logNewTabRequested('plus-button')
              onNew()
            }}
            onClick={(event) => {
              // Keyboard only — pointer presses already fired at pointerdown.
              if (event.detail !== 0) return
              logNewTabRequested('plus-button')
              onNew()
            }}
            className="titlebar-no-drag ml-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-tertiary outline-none ring-0 transition-colors hover:bg-zGray-800/60 hover:text-main focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
            aria-label="New tab"
          >
            <FontAwesomeIcon icon={faPlus} className="w-3.5 h-3.5" />
          </button>
        </Tooltip>
      </div>
      {tabContextMenu && (
        <WorkspaceTabsContextMenu
          menu={tabContextMenu}
          tabCount={tabs.length}
          canFavorite={contextMenuCanFavorite}
          favorited={contextMenuFavorited}
          onNew={onNew}
          onDuplicate={onDuplicate}
          onCopyPageUrl={onCopyPageUrl}
          toggleFavorite={toggleFavorite}
          handleClose={handleClose}
          onCloseOthers={onCloseOthers}
          onDismiss={() => setTabContextMenu(null)}
        />
      )}
      <TabStripActions
        firstRunConnectAvailable={firstRunConnectAvailable}
        onStartFirstRunConnect={onStartFirstRunConnect}
      />
    </div>
  )
}
