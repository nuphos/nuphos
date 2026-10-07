import { clsx } from 'clsx'
import { Plus, Search, Server } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { PageMeta } from '../../app/pageMeta'
import { useSidebarFavorites } from '../../components/sidebar/use-sidebar-favorites'
import { InputGroup, InputGroupInput } from '../../components/ui/input-group'
import { useBrowserHistory } from '../../hooks/useBrowserHistory'
import { useWorkspaceTab } from '../../hooks/useWorkspaceTab'
import { searchBrowserHistory } from '../../lib/browserHistory'
import { groupByConnectorCategory } from '../../lib/connectorCategories'
import { newTabOptionDomId, rankNewTabOptions } from '../../lib/launcherMatch'
import { TEAM_WORKSPACE_NAV_ITEMS } from '../../lib/teamOverviewNav'
import { RUNTIME_TERMINAL_FILTER } from '../../views/TerminalView'

import { HistoryIcon, LauncherIcon, NewTabGroupSection, NewTabOptionRow } from './NewTabOptions'

import type { Item, Section } from '../../components/sidebar/types'
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
  const searchRef = useRef<HTMLInputElement>(null)
  const { conversationId } = useWorkspaceTab()
  const history = useBrowserHistory(userId, teamId)
  const historyResults = useMemo(() => searchBrowserHistory(history, query), [history, query])

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
  const groups: OptionGroup[] = [
    { title: 'Favorites', favorites: true, options: itemOptions(favoriteItems) },
    { title: 'Workspace', options: itemOptions(workspaceItems) },
    ...liveSections.map((section) => ({
      title: section.title ?? '',
      options: itemOptions(section.items),
    })),
  ]
  const searching = query.trim() !== ''
  // While typing, every group collapses into one ranked list, history last.
  // With an empty query the grouped launcher stays.
  const options: NewTabOption[] = searching
    ? rankNewTabOptions(
        [
          ...groups.flatMap((group) =>
            group.options.map((option) => ({ ...option, detail: group.title })),
          ),
          ...historyResults.map((entry) => ({
            id: `history:${entry.url}`,
            label: entry.title,
            detail: entry.url,
            icon: <HistoryIcon />,
            fallbackMatch: true,
            open: (newTab: boolean) =>
              onOpenPath?.(
                `/teams/${encodeURIComponent(teamId)}/browser?${new URLSearchParams({ url: entry.url })}`,
                entry.title,
                newTab,
              ),
          })),
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
      <div className="relative h-full overflow-y-auto scrollbar-thin">
        <div className="pointer-events-none absolute left-1/2 top-0 h-48 w-80 -translate-x-1/2 rounded-full bg-zViolet-500/[0.045] blur-3xl" />
        <div className="relative mx-auto w-full max-w-[780px] px-7 pb-14 pt-12">
          <div className="mb-11 text-center">
            <span className="mx-auto flex h-9 w-9 items-center justify-center rounded-xl border border-zGray-800/65 bg-main/70 text-secondary shadow-[0_6px_18px_-8px_rgba(0,0,0,0.45)]">
              <Plus className="h-4 w-4" strokeWidth={1.65} />
            </span>
            <h1 className="mt-4 text-[20px] font-semibold tracking-[-0.025em] text-main">
              Open a workspace
            </h1>
            <p className="mt-1.5 text-[12.5px] text-tertiary">
              Pick up where you left off or explore a connected service.
            </p>
            <InputGroup
              render={<label />}
              className="mx-auto mt-6 flex h-11 max-w-[560px] items-center gap-3 rounded-xl border border-zGray-800/70 bg-main/75 px-3.5 shadow-[0_8px_28px_-16px_rgba(0,0,0,0.5)] transition-all focus-within:bg-main focus-within:shadow-[0_10px_32px_-14px_rgba(0,0,0,0.55)]"
            >
              <Search className="h-[15px] w-[15px] flex-shrink-0 text-tertiary" strokeWidth={1.7} />
              <InputGroupInput
                ref={searchRef}
                role="combobox"
                aria-expanded={options.length > 0}
                aria-controls="new-tab-options"
                aria-activedescendant={options[active] ? newTabOptionDomId(active) : undefined}
                aria-label="Search destinations and browsing history"
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
                placeholder="Search destinations or browsing history"
                className="text-[13px] text-main placeholder:text-tertiary"
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
            <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">
              {Array.from({ length: 6 }, (_, index) => (
                <div key={index} className="h-12 animate-pulse rounded-lg bg-zGray-800/25" />
              ))}
            </div>
          )}

          {!loading && (noConnectors || options.length === 0) && (
            <div
              className={clsx(
                'flex flex-col items-center rounded-xl border border-zGray-800/55 bg-elevated/20 px-6 py-10 text-center',
                searching && 'py-8',
              )}
            >
              <p className="text-[13px] font-medium text-secondary">
                {searching ? 'No matching destinations' : 'No connected resources yet'}
              </p>
              {!searching && (
                <button
                  type="button"
                  onClick={() => onOpenKey('team.integrations', null, false)}
                  className="mt-4 rounded-lg bg-zGray-800 px-3 py-1.5 text-[12px] font-medium text-main transition-colors hover:bg-zGray-700"
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
