import clsx from 'clsx'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Fragment } from 'react'

import { t } from '../../i18n'
import { useAgentAppearance } from '../../lib/agentAppearance'
import { favoriteSessionId } from '../../lib/sidebarPinnedChats'
import { SIDEBAR_ITEM_SHORTCUTS } from '../../lib/teamOverviewNav'
import {
  SIDEBAR_GROUP_GAP_CLASS,
  SIDEBAR_GROUP_ITEMS_CLASS,
  SIDEBAR_GROUP_TITLE_CLASS,
  SidebarNavIcon,
  SidebarNavItem,
} from '../SidebarNavItem'
import { Kbd } from '../ui/kbd'

import { DropLine } from './drop-line'
import { FavoriteToggle } from './favorite-toggle'
import { FinishedThreadsBadge, NestedRowBody } from './nest-guides'
import { nestItems } from './nest-items'
import { SidebarSectionSkeleton } from './parts'
import { SessionRowSurface } from './SessionRowSurface'
import { isSidebarItemActive } from './types'
import { useInboxBadge } from './use-inbox-badge'
import { usePinnedDrag } from './use-pinned-drag'

import type { Item, ItemMenuRequest, Section } from './types'
import type { SidebarFavorite } from '../../lib/sidebarFavorites'
import type { Scope } from '../../types'

// These titles double as section ids (chat-sections, Sidebar) and collapse-state
// keys, so they are translated only where they are shown.
const SECTION_LABELS: Record<string, string> = {
  Agents: t('Agents'),
  Pinned: t('Pinned'),
  Favorites: t('Favorites'),
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
  movePinned?: (item: Item, before: Item | null) => void
  onItemMenu: (menu: ItemMenuRequest) => void
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
  movePinned,
  onItemMenu,
  onSelect,
  onOpenKey,
}: SectionListProps) {
  // The Inbox row carries how many conversations wait on the viewer.
  const shown = useInboxBadge(scope.teamId, sections)
  const { density } = useAgentAppearance()
  const pinned = usePinnedDrag(shown.find((s) => s.title === 'Pinned')?.items ?? [], movePinned)

  return (
    <>
      {shown.map((section, idx) => (
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
              <span className="text-left">{SECTION_LABELS[section.title] ?? section.title}</span>
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
                {...(section.title === 'Pinned' && { ref: pinned.listRef, ...pinned.listHandlers })}
                className={clsx(
                  SIDEBAR_GROUP_ITEMS_CLASS,
                  't-panel-slide [--panel-translate-y:8px]',
                  section.title === 'Pinned' && 'relative',
                )}
                data-open="true"
              >
                {section.loading ? (
                  <SidebarSectionSkeleton />
                ) : (
                  nestItems(section.items, (key) => isGroupCollapsed({ title: key })).map(
                    ({ item, trail, hasChildren, hidden, done }) => {
                      const Icon = item.icon
                      const inPinned = section.title === 'Pinned'
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
                      // Same gate as the context menu: team-level, enabled rows only.
                      const shortcut = SIDEBAR_ITEM_SHORTCUTS[item.key]
                      const favorited = Boolean(favoriteMatch(item))
                      const chatRow = favoriteSessionId({ key: item.key, href: item.href }) !== null
                      const favoriteToggle = canFavorite(item) ? (
                        <FavoriteToggle
                          chatRow={chatRow}
                          favorited={favorited}
                          label={item.label}
                          onToggle={() => toggleFavorite(item)}
                        />
                      ) : null
                      // A thread parent folds its threads; the fold is remembered
                      // per team like a section's.
                      const folded = hasChildren && isGroupCollapsed({ title: item.key })
                      const foldToggle = hasChildren ? (
                        <span
                          role="button"
                          aria-label={folded ? t('Show sub-agents') : t('Hide sub-agents')}
                          title={folded ? t('Show sub-agents') : t('Hide sub-agents')}
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
                          sessionId={rowSessionId}
                          teamId={scope.teamId}
                          reorderDrag={inPinned ? pinned.rowDrag(item.key) : undefined}
                          onContextMenu={
                            // Only open when the menu would have something in it.
                            canFavorite(item) || (teamView && Boolean(rowSessionId))
                              ? (e) => {
                                  e.preventDefault()
                                  const moves = inPinned ? pinned.menuMoves(item.key) : undefined

                                  onItemMenu({ x: e.clientX, y: e.clientY, item, moves })
                                }
                              : undefined
                          }
                        >
                          <SidebarNavItem
                            active={isActive}
                            comfortable={chatRow && density === 'comfortable'}
                            sharedBackground={Boolean(item.description)}
                            disabled={!item.enabled}
                            navigateOnRelease={Boolean(rowSessionId)}
                            onClick={(event) => {
                              if (!item.enabled) return
                              // cmd/ctrl-click opens beside the current page, as it does
                              // everywhere else; a plain click still navigates in place.
                              const newTab = event.metaKey || event.ctrlKey

                              if (item.onActivate) item.onActivate(newTab)
                              else if (newTab && onOpenKey) onOpenKey(item.key, null, true)
                              else onSelect(item.key)
                            }}
                            label={item.label}
                            animateLabel={chatRow}
                            note={done.length ? <FinishedThreadsBadge threads={done} /> : undefined}
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
                                  {shortcut && (
                                    <Kbd combo={shortcut} className="pointer-events-none" />
                                  )}
                                  {favoriteToggle}
                                  {item.actions}
                                </>
                              ) : undefined
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
                          ref={inPinned ? pinned.rowRef(item.key) : undefined}
                          className={clsx(
                            't-collapse t-sidebar-session t-stagger relative',
                            archivingIds.has(rowSessionId) ? 'is-hiding' : 'is-shown',
                            pinned.isDragged(item.key) && 'opacity-40',
                          )}
                          data-open={archivingIds.has(rowSessionId) ? 'false' : 'true'}
                        >
                          {inPinned && pinned.dropIndex === pinned.heads.indexOf(item.key) && (
                            <DropLine edge="top" />
                          )}
                          <NestedRowBody
                            trail={trail}
                            expanded={hasChildren && !folded}
                            comfortable={density === 'comfortable'}
                          >
                            {row}
                          </NestedRowBody>
                        </div>
                      ) : (
                        <div key={item.key}>{row}</div>
                      )
                    },
                  )
                )}
                {section.title === 'Pinned' && pinned.dropIndex === pinned.heads.length && (
                  <DropLine edge="bottom" />
                )}
              </div>
            </div>
          </div>
        </div>
      ))}
      <div role="status" aria-live="polite" className="sr-only">
        {pinned.announcement}
      </div>
    </>
  )
}
