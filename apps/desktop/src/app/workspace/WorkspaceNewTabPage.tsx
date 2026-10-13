import { Plus, Search, Server } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../../api'
import { PageMeta } from '../../app/pageMeta'
import { useSidebarFavorites } from '../../components/sidebar/use-sidebar-favorites'
import { InputGroup, InputGroupInput } from '../../components/ui/input-group'
import { useDockHistory } from '../../hooks/useDockHistory'
import { useWorkspaceTab } from '../../hooks/useWorkspaceTab'
import { groupByConnectorCategory } from '../../lib/connectorCategories'
import { frecency, searchDockHistory } from '../../lib/dockHistory'
import { newTabOptionDomId, rankNewTabOptions } from '../../lib/launcherMatch'
import { TEAM_WORKSPACE_NAV_ITEMS } from '../../lib/teamOverviewNav'
import { RUNTIME_TERMINAL_FILTER } from '../../views/TerminalView'

import { HistoryIcon, LauncherIcon, NewTabGroupSection, NewTabOptionRow } from './NewTabOptions'

import type { Item, Section } from '../../components/sidebar/types'
import type { DockHistoryEntry } from '../../lib/dockHistory'
import type { NewTabOption } from '../../lib/launcherMatch'
import type { ReactNode } from 'react'

type Props = {
  focusSearch: boolean
  userId: string
  teamId: string
  rootIntegrations: Item[]
  loading: boolean
  currentHref: string
  scopeChipForPath?: (href: string) => { label: string; icon: ReactNode } | null
  onOpenPath?: (href: string, label: string, newTab: boolean) => void
  onOpenKey: (key: string, favoriteLabel: string | null, newTab: boolean) => void
}

type OptionGroup = { title: string; favorites?: boolean; options: NewTabOption[] }

const RECENT_LIMIT = 6
const sameTitle = (a: NewTabOption, b: NewTabOption) =>
  a.label.toLocaleLowerCase() === b.label.toLocaleLowerCase()

export function WorkspaceNewTabPage({
  focusSearch,
  userId,
  teamId,
  rootIntegrations,
  loading,
  currentHref,
  scopeChipForPath,
  onOpenPath,
  onOpenKey,
}: Props) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  // Frecency decays over days, so the time this New Tab opened is precise enough.
  const [now] = useState(() => Date.now())
  const searchRef = useRef<HTMLInputElement>(null)
  const { conversationId } = useWorkspaceTab()
  const history = useDockHistory(userId, teamId)

  useEffect(() => {
    if (!focusSearch) return
    const frame = window.requestAnimationFrame(() => {
      searchRef.current?.focus({ preventScroll: true })
      searchRef.current?.select()
    })

    return () => window.cancelAnimationFrame(frame)
  }, [focusSearch])

  const liveSections = useMemo<Section[]>(
    () =>
      groupByConnectorCategory(rootIntegrations).map(({ category, items }) => ({
        title: category.label,
        items,
      })),
    [rootIntegrations],
  )
  const { favoriteItems, toggleFavorite } = useSidebarFavorites({
    userId,
    teamId,
    teamView: true,
    sections: liveSections,
    currentHref,
    scopeChipForPath,
    onOpenPath,
    onOpenKey,
  })
  // Terminal is two destinations here, so picking one opens the shell directly
  // instead of landing on a chooser.
  const workspaceItems = TEAM_WORKSPACE_NAV_ITEMS.flatMap((item): Item[] =>
    item.key === 'team.terminal'
      ? [
          { ...item, label: 'Local terminal', enabled: true },
          {
            ...item,
            key: 'team.terminal.runtime',
            label: 'Runtime terminal',
            icon: Server,
            enabled: Boolean(conversationId && onOpenPath),
            onActivate: (newTab) =>
              onOpenPath?.(
                `/teams/${encodeURIComponent(teamId)}/terminal/${RUNTIME_TERMINAL_FILTER}`,
                'Runtime terminal',
                newTab,
              ),
          },
        ]
      : [{ ...item, enabled: true }],
  )
  const itemOption = (item: Item): NewTabOption => ({
    id: item.key,
    label: item.label,
    icon: <LauncherIcon item={item} />,
    item,
    open: (newTab) =>
      item.onActivate ? item.onActivate(newTab) : onOpenKey(item.key, null, newTab),
  })
  const itemOptions = (items: Item[]) => items.filter((item) => item.enabled).map(itemOption)
  // Every page this dock has shown, most frecent first. A page that is also a
  // launcher entry (same title) lends that entry its frecency instead.
  const historyOption = (entry: DockHistoryEntry): NewTabOption => ({
    id: `history:${entry.href}`,
    label: entry.title,
    detail: new URLSearchParams(entry.href.split('?')[1]).get('url') ?? 'Recent',
    icon: <HistoryIcon />,
    fallbackMatch: true,
    frecency: frecency(entry, now),
    open: (newTab) => onOpenPath?.(entry.href, entry.title, newTab),
  })
  const recent = searchDockHistory(history, '', now).map(historyOption)
  const groups: OptionGroup[] = [
    { title: 'Recent', options: recent.slice(0, RECENT_LIMIT) },
    { title: 'Favorites', favorites: true, options: itemOptions(favoriteItems) },
    { title: 'Workspace', options: itemOptions(workspaceItems) },
    ...liveSections.map((section) => ({
      title: section.title ?? '',
      options: itemOptions(section.items),
    })),
  ]
  const searching = query.trim() !== ''
  const launcherOptions = groups
    .slice(1)
    .flatMap((group) => group.options.map((option) => ({ ...option, detail: group.title })))
  // While typing, every group collapses into one list ranked by match, then
  // frecency. With an empty query the grouped launcher stays, Recent first.
  const options: NewTabOption[] = searching
    ? rankNewTabOptions(
        [
          ...launcherOptions.map((option) => ({
            ...option,
            frecency: recent.find((entry) => sameTitle(entry, option))?.frecency,
          })),
          ...searchDockHistory(history, query, now)
            .map(historyOption)
            .filter((entry) => !launcherOptions.some((option) => sameTitle(entry, option))),
        ],
        query,
      )
    : groups.flatMap((group) => group.options)
  const active = Math.min(activeIndex, options.length - 1)
  const visibleGroups = groups.filter((group) => group.options.length > 0)
  const noConnectors = !searching && liveSections.length === 0

  useEffect(() => {
    document.getElementById(newTabOptionDomId(active))?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const renderRow = (option: NewTabOption, index: number, favorites?: boolean) => (
    <NewTabOptionRow
      key={option.id}
      option={option}
      index={index}
      active={index === active}
      onHover={setActiveIndex}
      onRemoveFavorite={favorites ? toggleFavorite : undefined}
    />
  )
  let groupStart = 0

  return (
    <PageMeta
      pageKey="team.new-tab"
      title="New Tab"
      icon={<Plus className="h-3.5 w-3.5 text-tertiary" strokeWidth={1.8} />}
    >
      <div className="h-full overflow-y-auto scrollbar-thin">
        <div className="mx-auto w-full max-w-[640px] px-5 pb-10 pt-6">
          <div className="mb-5">
            <InputGroup
              render={<label />}
              className="flex h-9 items-center gap-2.5 rounded-lg border border-zGray-800/70 bg-main/75 px-3 transition-colors focus-within:bg-main"
            >
              <Search className="h-3.5 w-3.5 flex-shrink-0 text-tertiary" strokeWidth={1.7} />
              <InputGroupInput
                ref={searchRef}
                role="combobox"
                aria-expanded={options.length > 0}
                aria-controls="new-tab-options"
                aria-activedescendant={options[active] ? newTabOptionDomId(active) : undefined}
                aria-label="Search destinations and browsing history"
                onFocus={() => void api.appSelectAsciiInputSource().catch(() => {})}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return
                  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault()
                    const step = event.key === 'ArrowDown' ? 1 : -1

                    setActiveIndex(Math.max(0, Math.min(options.length - 1, active + step)))
                  } else if (event.key === 'Enter' && options[active]) {
                    event.preventDefault()
                    options[active].open(event.metaKey || event.ctrlKey)
                  } else if (event.key === 'Escape' && query) {
                    event.preventDefault()
                    setQuery('')
                    setActiveIndex(0)
                  }
                }}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setActiveIndex(0)
                }}
                placeholder="Search destinations or history"
                className="text-[12.5px] text-main placeholder:text-tertiary"
              />
            </InputGroup>
          </div>

          <div id="new-tab-options" role="listbox" aria-label="Destinations">
            {searching ? (
              <div className="space-y-0.5">
                {options.map((option, index) => renderRow(option, index))}
              </div>
            ) : (
              visibleGroups.map((group) => {
                const start = groupStart

                groupStart += group.options.length

                return (
                  <NewTabGroupSection
                    key={group.title}
                    title={group.title}
                    favorites={group.favorites}
                  >
                    {group.options.map((option, offset) =>
                      renderRow(option, start + offset, group.favorites),
                    )}
                  </NewTabGroupSection>
                )
              })
            )}
          </div>

          {loading && rootIntegrations.length === 0 && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-1">
              {Array.from({ length: 6 }, (_, index) => (
                <div key={index} className="h-9 animate-pulse rounded-md bg-zGray-800/25" />
              ))}
            </div>
          )}

          {!loading && (noConnectors || options.length === 0) && (
            <div className="flex flex-col items-center rounded-lg px-6 py-6 text-center">
              <p className="text-[12.5px] text-tertiary">
                {searching ? 'No matching destinations' : 'No connected resources yet'}
              </p>
              {!searching && (
                <button
                  type="button"
                  onClick={() => onOpenKey('team.integrations', null, false)}
                  className="mt-3 rounded-md bg-zGray-800 px-2.5 py-1 text-[12px] font-medium text-main transition-colors hover:bg-zGray-700"
                >
                  Add a connector
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </PageMeta>
  )
}
