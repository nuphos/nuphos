import clsx from 'clsx'
import { ChevronDown, ChevronRight } from 'lucide-react'

import { t } from '../../i18n'
import { favoriteSessionId } from '../../lib/sidebarPinnedChats'
import { SIDEBAR_ITEM_SHORTCUTS } from '../../lib/teamOverviewNav'
import {
  SIDEBAR_GROUP_GAP_CLASS,
  SIDEBAR_GROUP_ITEMS_CLASS,
  SidebarNavIcon,
  SidebarNavItem,
} from '../SidebarNavItem'
import { Kbd } from '../ui/kbd'

import { BotsDropZone } from './bot-drop'
import { BOTS_SECTION, foldKey } from './chat-sections'
import { FavoriteToggle } from './favorite-toggle'
import { FoldedStatus } from './folded-status'
import { NestedRowBody } from './nest-guides'
import { nestItems } from './nest-items'
import { SidebarSectionSkeleton } from './parts'
import { RowDetail } from './row-detail'
import { rowNote } from './row-note'
import { SessionRowSurface } from './SessionRowSurface'
import { SidebarSectionHeading } from './SidebarSectionHeading'
import { isSidebarItemActive } from './types'
import { useInboxBadge } from './use-inbox-badge'

import type { Item, ItemMenuRequest, Section } from './types'
import type { SidebarFavorite } from '../../lib/sidebarFavorites'
import type { Scope } from '../../types'

type SectionListProps = {
  botPins?: { order: string[]; place: (item: Item, before: Item | null) => void }
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
  onItemMenu: (menu: ItemMenuRequest) => void
  onSelect: (key: string) => void
  onOpenKey?: (key: string, favoriteLabel: string | null, newTab: boolean) => void
}

function foldLabel(item: Item, folded: boolean): string {
  if (item.project) return folded ? t('Expand') : t('Collapse')

  return folded ? t('Show sub-agents') : t('Hide sub-agents')
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
  // The Inbox row carries how many conversations wait on the viewer.
  const shown = useInboxBadge(scope.teamId, sections)
  const collapsedIn = (section: Section) => (key: string) =>
    isGroupCollapsed({ title: foldKey(section, key) })

  return (
    <>
      {shown.map((section, idx) => (
        <BotsDropZone
          key={idx}
          // A Task dropped on Bots becomes a Bot.
          enabled={section.title === BOTS_SECTION}
          teamId={scope.teamId}
          className={clsx(
            'transition-[margin-bottom] duration-200',
            section.separator && 'mt-2 border-t border-line-control/60 pt-2',
            section.compact ? 'mb-0' : isGroupCollapsed(section) ? 'mb-1' : SIDEBAR_GROUP_GAP_CLASS,
          )}
        >
          {(dropSlot) => (
            <>
              {section.title && (
                <div className="flex items-center">
                  <SidebarSectionHeading
                    section={section}
                    collapsed={isGroupCollapsed(section)}
                    toggle={() => toggleGroup(section)}
                  />
                  {section.action}
                </div>
              )}
              {dropSlot}
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
                      nestItems(section.items, collapsedIn(section)).map(
                        ({ item, trail, hasChildren, hidden, done }) => {
                          const Icon = item.icon
                          const leading = item.iconNode ?? (Icon && <SidebarNavIcon icon={Icon} />)
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
                          const chatRow =
                            favoriteSessionId({ key: item.key, href: item.href }) !== null
                          // Bots read as a chat list (name over latest message); Tasks as on main.
                          const twoLine = chatRow && !item.task
                          const bot = twoLine || Boolean(item.botNested)
                          const favoriteToggle = canFavorite(item) ? (
                            <FavoriteToggle
                              pin={Boolean(item.bot || item.botChannelOf)}
                              favorited={favorited}
                              label={item.label}
                              onToggle={() => toggleFavorite(item)}
                            />
                          ) : null
                          // A thread parent folds its threads; the fold is remembered
                          // per team like a section's.
                          const folded = hasChildren && collapsedIn(section)(item.key)
                          const foldToggle = hasChildren ? (
                            <span
                              role="button"
                              aria-label={foldLabel(item, folded)}
                              title={foldLabel(item, folded)}
                              onClick={(e) => {
                                e.stopPropagation()
                                toggleGroup({ title: foldKey(section, item.key) })
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
                              revealDetail={Boolean(item.description)}
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
                                twoLine={twoLine}
                                sharedBackground={Boolean(item.description)}
                                disabled={!item.enabled}
                                navigateOnRelease={Boolean(rowSessionId)}
                                onClick={(event) => {
                                  if (!item.enabled) return
                                  item.onPress?.()
                                  // cmd/ctrl-click opens beside the current page, as it does
                                  // everywhere else; a plain click still navigates in place.
                                  const newTab = event.metaKey || event.ctrlKey

                                  if (item.onActivate) item.onActivate(newTab)
                                  else if (newTab && onOpenKey) onOpenKey(item.key, null, true)
                                  else onSelect(item.key)
                                }}
                                label={item.label}
                                preview={twoLine ? (item.previewNode ?? item.preview) : undefined}
                                labelShimmer={item.labelShimmer}
                                time={twoLine ? item.time : undefined}
                                animateLabel={chatRow}
                                note={rowNote(item, done)}
                                badge={item.badge}
                                trailing={
                                  <>
                                    {item.trailing}
                                    <FoldedStatus rows={hidden} />
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
                                icon={leading ?? null}
                                revealDetail={Boolean(item.description)}
                              />
                              <RowDetail item={item} />
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
                                't-collapse t-sidebar-session t-stagger relative transition-opacity duration-150',
                                item.task &&
                                  !item.bot &&
                                  item.taskState === 'idle' &&
                                  !isActive &&
                                  'opacity-50 hover:opacity-100 focus-within:opacity-100',
                                archivingIds.has(rowSessionId) ? 'is-hiding' : 'is-shown',
                              )}
                              title={
                                item.task && !item.bot && item.taskState === 'working'
                                  ? t('Working')
                                  : item.task && !item.bot && item.taskState === 'idle'
                                    ? t('Idle')
                                    : undefined
                              }
                              data-open={archivingIds.has(rowSessionId) ? 'false' : 'true'}
                            >
                              <NestedRowBody
                                trail={trail}
                                expanded={hasChildren && !folded}
                                bot={bot}
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
                  </div>
                </div>
              </div>
            </>
          )}
        </BotsDropZone>
      ))}
    </>
  )
}
