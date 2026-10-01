import { faXmark } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import clsx from 'clsx'
import { Star } from 'lucide-react'

import { logTabClicked } from '../../../lib/tabSwitchLog'
import { toAbsoluteAtlasUrl } from '../../../lib/webBaseUrl'
import { isPermanentSidebarPage } from '../../navItems'
import { workspaceTabDisplayMeta } from '../../tabDisplayMeta'

import type { TabContextMenuState } from './tabsTypes'
import type { TabPointerDrag } from './useTabDragPreview'
import type { DatabaseConnection } from '../../../types'
import type { AccountSet, WorkspaceTabState } from '../../workspaceTabState'
import type {
  CSSProperties,
  Dispatch,
  MouseEvent as ReactMouseEvent,
  MutableRefObject,
  PointerEvent as ReactPointerEvent,
  SetStateAction,
} from 'react'

type WorkspaceTabItemProps = {
  tab: WorkspaceTabState
  accounts: AccountSet | undefined
  databaseConnections: DatabaseConnection[]
  selected: boolean
  showClose: boolean
  dragging: boolean
  dragOffsetX: number
  previewOffset: number | undefined
  isFavorited: (teamId: string, appHref: string) => boolean
  toggleFavorite: (teamId: string, appHref: string, title: string) => boolean
  handleClose: (id: string) => void
  handleTabPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, tabId: string) => void
  handleTabMouseDown: (event: ReactMouseEvent<HTMLButtonElement>, tabId: string) => void
  clearTabDragState: () => void
  onSelect: (id: string) => void
  tabRefs: MutableRefObject<Map<string, HTMLDivElement>>
  tabPointerDragRef: MutableRefObject<TabPointerDrag | null>
  suppressTabClickRef: MutableRefObject<string | null>
  setTabContextMenu: Dispatch<SetStateAction<TabContextMenuState | null>>
}

export function WorkspaceTabItem({
  tab,
  accounts,
  databaseConnections,
  selected,
  showClose,
  dragging,
  dragOffsetX,
  previewOffset,
  isFavorited,
  toggleFavorite,
  handleClose,
  handleTabPointerDown,
  handleTabMouseDown,
  clearTabDragState,
  onSelect,
  tabRefs,
  tabPointerDragRef,
  suppressTabClickRef,
  setTabContextMenu,
}: WorkspaceTabItemProps) {
  const meta = workspaceTabDisplayMeta(tab, accounts, databaseConnections)
  // An Overview page is already a permanent sidebar row, so there is
  // nothing to pin — only tabs the sidebar can't otherwise reach
  // (chats, drill-downs, filtered pages) get the star.
  const canFavorite = !isPermanentSidebarPage(meta.location.href)
  const favorited = canFavorite && isFavorited(tab.scope.teamId, meta.location.href)
  const tabStyle: CSSProperties & {
    '--tab-drag-x'?: string
    '--tab-preview-x'?: string
  } = dragging
    ? { '--tab-drag-x': `${String(dragOffsetX)}px` }
    : previewOffset
      ? { '--tab-preview-x': `${String(previewOffset)}px` }
      : {}

  return (
    <div
      ref={(el) => {
        if (el) tabRefs.current.set(tab.id, el)
        else tabRefs.current.delete(tab.id)
      }}
      className="titlebar-no-drag t-tab"
      data-active={selected ? 'true' : undefined}
      data-dragging={dragging ? 'true' : undefined}
      data-preview-shift={previewOffset ? (previewOffset > 0 ? 'right' : 'left') : undefined}
      style={tabStyle}
    >
      <div
        className="t-tab-content group relative flex items-center w-full min-w-0"
        // Middle-click closes the tab, anywhere on it. The drag
        // handlers already ignore non-primary buttons, so this can't
        // collide with a reorder.
        onAuxClick={(event) => {
          if (event.button !== 1) return
          event.preventDefault()
          handleClose(tab.id)
        }}
        onMouseDown={(event) => {
          // Keep the middle-click autoscroll cursor from appearing
          // between mousedown and the auxclick that closes the tab.
          if (event.button === 1) event.preventDefault()
        }}
      >
        <button
          type="button"
          onPointerDown={(event) => {
            // Activate on press, not on release: the click event only
            // fires on mouseup, so waiting for it adds the entire held
            // press (~80-100ms) to the perceived latency — measured
            // switch times were identical to Cmd+T, yet Cmd+T felt
            // faster. Chrome's tab strip activates on mousedown for
            // the same reason. Keyboard activation still arrives via
            // click below.
            if (event.button === 0) {
              logTabClicked(tab.id)
              onSelect(tab.id)
            }
            handleTabPointerDown(event, tab.id)
          }}
          onMouseDown={(event) => handleTabMouseDown(event, tab.id)}
          onClick={(event) => {
            if (suppressTabClickRef.current === tab.id) {
              event.preventDefault()
              suppressTabClickRef.current = null

              return
            }
            // Pointer presses were handled at pointerdown; a keyboard
            // activation (Enter/Space) is a click with detail 0.
            if (event.detail !== 0) return
            logTabClicked(tab.id)
            onSelect(tab.id)
          }}
          onContextMenu={(event) => {
            event.preventDefault()
            event.stopPropagation()
            tabPointerDragRef.current = null
            clearTabDragState()
            setTabContextMenu({
              tabId: tab.id,
              href: toAbsoluteAtlasUrl(meta.location.href),
              appHref: meta.location.href,
              title: meta.title,
              teamId: tab.scope.teamId,
              x: event.clientX,
              y: event.clientY,
            })
          }}
          data-page-path={meta.location.href}
          className={clsx(
            'titlebar-no-drag h-[30px] w-full min-w-0 select-none cursor-grab active:cursor-grabbing flex items-center gap-1.5 text-[12.5px] transition-colors outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0',
            // Reserve the trailing slots up front so revealing them on
            // hover never reflows the title.
            showClose && canFavorite
              ? 'pl-2.5 pr-10'
              : showClose || canFavorite
                ? 'pl-2.5 pr-7'
                : 'px-2.5',
            'rounded-[9px]',
            selected
              ? 'bg-zGray-800/60 text-main'
              : 'bg-transparent text-tertiary hover:bg-zGray-800/45 hover:text-main focus-visible:bg-zGray-800/45',
          )}
        >
          <span
            className={clsx(
              'flex-shrink-0 transition-opacity',
              !selected && 'opacity-70 group-hover:opacity-100',
            )}
          >
            {meta.icon}
          </span>
          <span
            className={clsx(
              'truncate flex-1 text-left transition-opacity',
              !selected && 'opacity-70 group-hover:opacity-100',
            )}
          >
            {meta.title}
          </span>
        </button>
        {canFavorite && (
          <button
            type="button"
            onPointerDown={(e) => {
              e.stopPropagation()
            }}
            onMouseDown={(e) => {
              e.stopPropagation()
            }}
            onClick={(e) => {
              e.stopPropagation()
              toggleFavorite(tab.scope.teamId, meta.location.href, meta.title)
            }}
            className={clsx(
              'titlebar-no-drag t-workspace-tab-action absolute top-1/2 z-10 -translate-y-1/2 w-[18px] h-[18px] rounded flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 outline-none focus-visible:outline-none hover:bg-zGray-800/70',
              showClose ? 'right-6' : 'right-1',
              favorited ? 'text-warning hover:text-warning/70' : 'text-tertiary hover:text-main',
            )}
            aria-pressed={favorited}
            aria-label={
              favorited ? `Remove ${meta.title} from Favorites` : `Add ${meta.title} to Favorites`
            }
            title={favorited ? 'Remove from Favorites' : 'Add to Favorites'}
          >
            <Star
              className="w-3.5 h-3.5"
              strokeWidth={1.8}
              fill={favorited ? 'currentColor' : 'none'}
            />
          </button>
        )}
        {showClose && (
          <button
            type="button"
            onPointerDown={(e) => {
              e.stopPropagation()
              // Close on press, like tab activation. Non-primary
              // buttons fall through so middle-click still closes
              // via the wrapper's auxclick.
              if (e.button === 0) handleClose(tab.id)
            }}
            onMouseDown={(e) => {
              e.stopPropagation()
            }}
            onClick={(e) => {
              e.stopPropagation()
              // Keyboard only — pointer presses already fired at
              // pointerdown.
              if (e.detail !== 0) return
              handleClose(tab.id)
            }}
            className={clsx(
              'titlebar-no-drag t-workspace-tab-action absolute right-1 top-1/2 z-10 -translate-y-1/2 w-[18px] h-[18px] rounded flex items-center justify-center text-tertiary hover:bg-zGray-800/70 hover:text-main group-hover:opacity-100 focus:opacity-100 outline-none focus-visible:outline-none',
              selected ? 'opacity-100' : 'opacity-0',
            )}
            aria-label={`Close tab ${meta.title}`}
            title="Close tab"
          >
            <FontAwesomeIcon icon={faXmark} className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  )
}
