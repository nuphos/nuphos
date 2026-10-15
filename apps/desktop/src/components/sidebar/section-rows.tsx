import clsx from 'clsx'
import { ChevronDown, ChevronRight, Star } from 'lucide-react'
import { Fragment } from 'react'

import { favoriteSessionId, favoriteToggleTitle } from '../../lib/sidebarPinnedChats'
import { SIDEBAR_ITEM_SHORTCUTS } from '../../lib/teamOverviewNav'
import { SidebarNavIcon, SidebarNavItem } from '../SidebarNavItem'
import { Kbd } from '../ui/kbd'

import { endChatDrag, startChatDrag } from './chat-drag'
import { NestedRowBody } from './nest-guides'
import { nestItems } from './nest-items'
import { SessionRowSurface } from './SessionRowSurface'
import { isSidebarItemActive } from './types'

import type { Item, Section } from './types'
import type { SidebarFavorite } from '../../lib/sidebarFavorites'
import type { Scope } from '../../types'

/** Hover controls are 20px squares 4px apart; the one shortcut chip is ~30px. */
function hoverActionsWidth(...controls: unknown[]): number {
  const widths = controls.flatMap((control, index) => (control ? [index === 0 ? 30 : 20] : []))

  return widths.reduce((sum, width) => sum + width, 0) + Math.max(0, widths.length - 1) * 4
}

function favoriteToggleAriaLabel(chatRow: boolean, favorited: boolean, label: string): string {
  if (chatRow) return `${favorited ? 'Unpin' : 'Pin'} ${label}`

  return favorited ? `Remove ${label} from Favorites` : `Add ${label} to Favorites`
}

/** Everything a row needs from the sidebar, shared by sections and project folders. */
export type SidebarRowsContext = {
  scope: Scope
  active: string
  teamView: boolean
  newChatActive: boolean
  archivingIds: ReadonlySet<string>
  isGroupCollapsed: (section: Pick<Section, 'title' | 'defaultCollapsed'>) => boolean
  toggleGroup: (section: Pick<Section, 'title' | 'defaultCollapsed'>) => void
  favoriteMatch: (item: Item) => SidebarFavorite | undefined
  canFavorite: (item: Item) => boolean
  toggleFavorite: (item: Item) => void
  onItemMenu: (menu: { x: number; y: number; item: Item }) => void
  onSelect: (key: string) => void
  onOpenKey?: (key: string, favoriteLabel: string | null, newTab: boolean) => void
}

/** A group's rows, each thread nested under the chat that opened it. */
export function SidebarRows({
  items,
  scope,
  active,
  teamView,
  newChatActive,
  archivingIds,
  isGroupCollapsed,
  toggleGroup,
  favoriteMatch,
  canFavorite,
  toggleFavorite,
  onItemMenu,
  onSelect,
  onOpenKey,
}: SidebarRowsContext & { items: Item[] }) {
  return (
    <>
      {nestItems(items, (key) => isGroupCollapsed({ title: key })).map(
        ({ item, trail, hasChildren, hidden }) => {
          const Icon = item.icon
          const isActive =
            item.enabled &&
            (item.key === 'team.agent'
              ? newChatActive
              : item.active ||
                isSidebarItemActive(scope, active, item.key) ||
                // A folded parent stands in for the open thread it hides.
                hidden.some((row) => row.active))
          const rowSessionId = item.key.startsWith('agent-session:')
            ? item.key.slice('agent-session:'.length)
            : null
          // Hover-revealed pin toggle, so favoriting is discoverable
          // without knowing about the right-click menu — and so a
          // Favorites row can unpin itself in place. Same gate as the
          // context menu: team-level, enabled rows only.
          const shortcut = SIDEBAR_ITEM_SHORTCUTS[item.key]
          const favorited = Boolean(favoriteMatch(item))
          const chatRow = favoriteSessionId({ key: item.key, href: item.href }) !== null
          const favoriteToggle = canFavorite(item) ? (
            <span
              role="button"
              aria-label={favoriteToggleAriaLabel(chatRow, favorited, item.label)}
              title={favoriteToggleTitle(chatRow, favorited)}
              onClick={(e) => {
                e.stopPropagation()
                toggleFavorite(item)
              }}
              className={clsx(
                'flex-shrink-0 inline-flex items-center justify-center w-5 h-5 rounded hover:bg-[var(--sidebar-overlay-hover)]',
                favorited ? 'text-warning hover:text-warning/70' : 'text-tertiary hover:text-main',
              )}
            >
              <Star
                className="w-3.5 h-3.5"
                strokeWidth={1.8}
                fill={favorited ? 'currentColor' : 'none'}
              />
            </span>
          ) : null
          // A thread parent folds its threads; the fold is remembered
          // per team like a section's.
          const folded = hasChildren && isGroupCollapsed({ title: item.key })
          const foldToggle = hasChildren ? (
            <span
              role="button"
              aria-label={folded ? 'Show threads' : 'Hide threads'}
              title={folded ? 'Show threads' : 'Hide threads'}
              onClick={(e) => {
                e.stopPropagation()
                toggleGroup({ title: item.key })
              }}
              className={clsx(
                'flex-shrink-0 inline-flex items-center justify-center w-5 h-5 rounded text-tertiary hover:text-main hover:bg-[var(--sidebar-overlay-hover)]',
                // Always in flow so the row never reflows; shown at rest only when folded.
                !folded && 'invisible group-hover:visible',
              )}
            >
              {folded ? (
                <ChevronRight className="w-3.5 h-3.5" strokeWidth={1.8} />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" strokeWidth={1.8} />
              )}
            </span>
          ) : null
          const row = (
            <SessionRowSurface
              item={item}
              active={isActive}
              onOpenKey={onOpenKey}
              onSelect={onSelect}
              onContextMenu={
                // Only open when the menu would have something in it.
                canFavorite(item) || (teamView && Boolean(rowSessionId))
                  ? (e) => {
                      e.preventDefault()
                      onItemMenu({ x: e.clientX, y: e.clientY, item })
                    }
                  : undefined
              }
            >
              <SidebarNavItem
                active={isActive}
                sharedBackground={Boolean(item.description)}
                disabled={!item.enabled}
                onClick={(event) => {
                  if (!item.enabled) return
                  // cmd/ctrl-click opens beside the current page, the
                  // way it does everywhere else; a plain click still
                  // navigates in place.
                  const newTab = event.metaKey || event.ctrlKey

                  if (item.onActivate) item.onActivate(newTab)
                  else if (newTab && onOpenKey) onOpenKey(item.key, null, true)
                  else onSelect(item.key)
                }}
                label={item.label}
                badge={item.badge}
                trailing={
                  <>
                    {item.trailing}
                    {/* One dot for whatever the fold hides; the rest render null. */}
                    <span className="contents [&>*:not(:first-child)]:hidden">
                      {hidden.map((row) => (
                        <Fragment key={row.key}>{row.foldedStatus}</Fragment>
                      ))}
                    </span>
                  </>
                }
                edge={foldToggle}
                hoverActions={
                  shortcut || favoriteToggle || item.actions ? (
                    <>
                      {shortcut && <Kbd combo={shortcut} className="pointer-events-none" />}
                      {favoriteToggle}
                      {item.actions}
                    </>
                  ) : undefined
                }
                hoverActionsWidth={hoverActionsWidth(shortcut, favoriteToggle, item.actions)}
                icon={item.iconNode ?? (Icon && <SidebarNavIcon icon={Icon} />)}
              />
              {item.description}
            </SessionRowSurface>
          )

          // Chat rows collapse out (t-collapse, grid-rows) while an
          // archive is in flight; other rows render flat.
          // Keyed by item.key, not index: the list shrinks when an
          // archive lands, and positional keys would hand the removed
          // row's data-open state to its neighbor, replaying a bogus
          // collapse.
          return rowSessionId ? (
            <div
              key={item.key}
              className={clsx(
                't-collapse t-sidebar-session t-stagger relative',
                archivingIds.has(rowSessionId) ? 'is-hiding' : 'is-shown',
              )}
              data-open={archivingIds.has(rowSessionId) ? 'false' : 'true'}
              draggable={teamView}
              onDragStart={teamView ? (event) => startChatDrag(event, rowSessionId) : undefined}
              onDragEnd={endChatDrag}
            >
              <NestedRowBody trail={trail} expanded={hasChildren && !folded}>
                {row}
              </NestedRowBody>
            </div>
          ) : (
            <div key={item.key}>{row}</div>
          )
        },
      )}
    </>
  )
}
