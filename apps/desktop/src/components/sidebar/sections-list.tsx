import clsx from 'clsx'
import { ChevronDown, ChevronRight, Star } from 'lucide-react'

import { favoriteSessionId, favoriteToggleTitle } from '../../lib/sidebarPinnedChats'
import { SIDEBAR_ITEM_SHORTCUTS } from '../../lib/teamOverviewNav'
import {
  SIDEBAR_GROUP_GAP_CLASS,
  SIDEBAR_GROUP_ITEMS_CLASS,
  SIDEBAR_GROUP_TITLE_CLASS,
  SidebarNavIcon,
  SidebarNavItem,
} from '../SidebarNavItem'
import { Kbd } from '../ui/kbd'

import { nestItems } from './nest-items'
import { SidebarSectionSkeleton } from './parts'
import { SessionRowSurface } from './SessionRowSurface'
import { isSidebarItemActive } from './types'

import type { Item, Section } from './types'
import type { SidebarFavorite } from '../../lib/sidebarFavorites'
import type { Scope } from '../../types'

// A nested row's indent; it also puts each guide under its parent's icon.
const NEST_INDENT = 16

function favoriteToggleAriaLabel(chatRow: boolean, favorited: boolean, label: string): string {
  if (chatRow) return `${favorited ? 'Unpin' : 'Pin'} ${label}`

  return favorited ? `Remove ${label} from Favorites` : `Add ${label} to Favorites`
}

type SectionListProps = {
  sections: Section[]
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

export function SidebarSectionList({
  sections,
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
}: SectionListProps) {
  return (
    <>
      {sections.map((section, idx) => (
        <div
          key={idx}
          className={clsx(
            'transition-[margin-bottom] duration-200',
            isGroupCollapsed(section) ? 'mb-1' : SIDEBAR_GROUP_GAP_CLASS,
          )}
        >
          {section.title && (
            <button
              type="button"
              onPointerDown={(event) => {
                if (event.button === 0) toggleGroup(section)
              }}
              onClick={(event) => {
                if (event.detail === 0) toggleGroup(section)
              }}
              className={clsx(
                SIDEBAR_GROUP_TITLE_CLASS,
                'w-full hover:text-secondary flex items-center gap-1.5',
              )}
            >
              <span className="text-left">{section.title}</span>
              <span
                className="t-icon-swap w-3 h-3 flex-shrink-0"
                data-state={isGroupCollapsed(section) ? 'a' : 'b'}
              >
                <ChevronRight className="t-icon w-3 h-3" data-icon="a" />
                <ChevronDown className="t-icon w-3 h-3" data-icon="b" />
              </span>
            </button>
          )}
          <div className="t-collapse" data-open={isGroupCollapsed(section) ? 'false' : 'true'}>
            <div className="t-collapse-inner">
              <div
                className={clsx(
                  SIDEBAR_GROUP_ITEMS_CLASS,
                  't-panel-slide [--panel-translate-y:8px]',
                )}
                data-open="true"
              >
                {section.loading ? (
                  <SidebarSectionSkeleton />
                ) : (
                  nestItems(section.items).map(({ item, depth }) => {
                    const Icon = item.icon
                    const isActive =
                      item.enabled &&
                      (item.key === 'team.agent'
                        ? newChatActive
                        : item.active || isSidebarItemActive(scope, active, item.key))
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
                          'flex-shrink-0 hidden group-hover:inline-flex items-center justify-center w-5 h-5 rounded hover:bg-[var(--sidebar-overlay-hover)]',
                          favorited
                            ? 'text-warning hover:text-warning/70'
                            : 'text-tertiary hover:text-main',
                        )}
                      >
                        <Star
                          className="w-3.5 h-3.5"
                          strokeWidth={1.8}
                          fill={favorited ? 'currentColor' : 'none'}
                        />
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
                              {shortcut && (
                                <Kbd
                                  combo={shortcut}
                                  className="pointer-events-none hidden group-hover:inline-flex"
                                />
                              )}
                              {favoriteToggle}
                              {item.trailing}
                              {item.actions}
                            </>
                          }
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
                          't-collapse t-sidebar-session t-stagger',
                          archivingIds.has(rowSessionId) ? 'is-hiding' : 'is-shown',
                        )}
                        data-open={archivingIds.has(rowSessionId) ? 'false' : 'true'}
                      >
                        <div
                          className="t-collapse-inner t-stagger-line relative"
                          style={depth ? { paddingLeft: depth * NEST_INDENT } : undefined}
                        >
                          {row}
                          {/* One guide per ancestor, under its icon; adjacent rows join them. */}
                          {Array.from({ length: depth }, (_, level) => (
                            <span
                              key={level}
                              aria-hidden
                              className="pointer-events-none absolute inset-y-0 w-px bg-zGray-800/60"
                              style={{ left: (level + 1) * NEST_INDENT }}
                            />
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div key={item.key}>{row}</div>
                    )
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      ))}
    </>
  )
}
