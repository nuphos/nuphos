import { clsx } from 'clsx'
import { ChevronRight, Plus, Search, Star } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { PageMeta } from '../../app/pageMeta'
import { useSidebarFavorites } from '../../components/sidebar/use-sidebar-favorites'
import { InputGroup, InputGroupInput } from '../../components/ui/input-group'
import { useBrowserHistory } from '../../hooks/useBrowserHistory'
import { searchBrowserHistory } from '../../lib/browserHistory'
import { groupByConnectorCategory } from '../../lib/connectorCategories'
import { TEAM_WORKSPACE_NAV_ITEMS } from '../../lib/teamOverviewNav'

import { BrowserHistoryResults } from './BrowserHistoryResults'

import type { Item, Section } from '../../components/sidebar/types'
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

const WORKSPACE_ITEMS: Item[] = TEAM_WORKSPACE_NAV_ITEMS.map((item) => ({ ...item, enabled: true }))

function LauncherSection({
  title,
  items,
  onOpen,
}: {
  title: string
  items: Item[]
  onOpen: (item: Item, newTab: boolean) => void
}) {
  return (
    <section className="mb-8">
      <h2 className="mb-2 px-1 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-tertiary">
        {title}
      </h2>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-x-3 gap-y-0.5">
        {items.map((item) => (
          <LauncherCard key={item.key} item={item} onOpen={onOpen} />
        ))}
      </div>
    </section>
  )
}

function LauncherIcon({ item }: { item: Item }) {
  const Icon = item.icon

  return (
    <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-zGray-800/45 text-secondary ring-1 ring-inset ring-zGray-700/20 transition-colors group-hover:bg-zGray-800/75 group-hover:text-main">
      {item.iconNode ?? (Icon ? <Icon className="h-[15px] w-[15px]" strokeWidth={1.7} /> : null)}
    </span>
  )
}

function LauncherCard({
  item,
  onOpen,
  onRemoveFavorite,
}: {
  item: Item
  onOpen: (item: Item, newTab: boolean) => void
  onRemoveFavorite?: (item: Item) => void
}) {
  return (
    <div className="group flex min-w-0 items-center rounded-lg transition-colors hover:bg-zGray-800/45">
      <button
        type="button"
        disabled={!item.enabled}
        onClick={(event) => onOpen(item, event.metaKey || event.ctrlKey)}
        className="flex min-w-0 flex-1 items-center gap-3 px-2.5 py-2 text-left outline-none disabled:opacity-45 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-zViolet-accent/45"
      >
        <LauncherIcon item={item} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-main">
          {item.label}
        </span>
        <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 translate-x-[-2px] text-tertiary opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
      </button>
      {onRemoveFavorite && (
        <button
          type="button"
          onClick={() => onRemoveFavorite(item)}
          className="mr-1.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-warning/80 opacity-0 transition-all hover:bg-zGray-700/45 hover:text-warning group-hover:opacity-100 focus:opacity-100"
          title={`Remove ${item.label} from Favorites`}
          aria-label={`Remove ${item.label} from Favorites`}
        >
          <Star className="h-3.5 w-3.5" fill="currentColor" strokeWidth={1.7} />
        </button>
      )}
    </div>
  )
}

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
  const searchRef = useRef<HTMLInputElement>(null)
  const firstHistoryResultRef = useRef<HTMLButtonElement>(null)
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

  const openHistory = (url: string, title: string, newTab: boolean) => {
    const params = new URLSearchParams({ url })

    onOpenPath?.(`/teams/${encodeURIComponent(teamId)}/browser?${params}`, title, newTab)
  }
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
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filterItems = (items: Item[]) =>
    normalizedQuery
      ? items.filter((item) => item.label.toLocaleLowerCase().includes(normalizedQuery))
      : items
  const visibleFavorites = filterItems(favoriteItems)
  const visibleWorkspaceItems = filterItems(WORKSPACE_ITEMS)
  const visibleSections = liveSections
    .map((section) => ({ ...section, items: filterItems(section.items) }))
    .filter((section) => section.items.length > 0)
  const hasResults =
    historyResults.length > 0 ||
    visibleFavorites.length > 0 ||
    visibleWorkspaceItems.length > 0 ||
    visibleSections.length > 0
  const noConnectors = !normalizedQuery && liveSections.length === 0
  const openItem = (item: Item, newTab: boolean) => {
    if (!item.enabled) return
    if (item.onActivate) item.onActivate(newTab)
    else onOpenKey(item.key, null, newTab)
  }

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
                aria-label="Search destinations and browsing history"
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing || !historyResults[0]) return
                  if (event.key === 'ArrowDown') {
                    event.preventDefault()
                    firstHistoryResultRef.current?.focus()
                  } else if (event.key === 'Enter') {
                    event.preventDefault()
                    const first = historyResults[0]

                    openHistory(first.url, first.title, event.metaKey || event.ctrlKey)
                  }
                }}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search destinations or browsing history"
                className="text-[13px] text-main placeholder:text-tertiary"
              />
            </InputGroup>
          </div>

          <BrowserHistoryResults
            entries={historyResults}
            firstResultRef={firstHistoryResultRef}
            onOpen={openHistory}
          />

          {visibleFavorites.length > 0 && (
            <section className="mb-10">
              <div className="mb-2.5 flex items-center gap-2 px-1">
                <Star className="h-3 w-3 text-warning/80" fill="currentColor" strokeWidth={1.7} />
                <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-tertiary">
                  Favorites
                </h2>
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-x-3 gap-y-0.5 rounded-xl border border-zGray-800/55 bg-elevated/20 p-1.5 shadow-[0_4px_18px_-14px_rgba(0,0,0,0.45)]">
                {visibleFavorites.map((item) => (
                  <LauncherCard
                    key={item.key}
                    item={item}
                    onOpen={openItem}
                    onRemoveFavorite={toggleFavorite}
                  />
                ))}
              </div>
            </section>
          )}

          {visibleWorkspaceItems.length > 0 && (
            <LauncherSection title="Workspace" items={visibleWorkspaceItems} onOpen={openItem} />
          )}

          {loading && rootIntegrations.length === 0 ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">
              {Array.from({ length: 6 }, (_, index) => (
                <div key={index} className="h-12 animate-pulse rounded-lg bg-zGray-800/25" />
              ))}
            </div>
          ) : (
            visibleSections.map((section) => (
              <LauncherSection
                key={section.title}
                title={section.title ?? ''}
                items={section.items}
                onOpen={openItem}
              />
            ))
          )}

          {!loading && (noConnectors || !hasResults) && (
            <div
              className={clsx(
                'flex flex-col items-center rounded-xl border border-zGray-800/55 bg-elevated/20 px-6 py-10 text-center',
                normalizedQuery && 'py-8',
              )}
            >
              <p className="text-[13px] font-medium text-secondary">
                {normalizedQuery ? 'No matching destinations' : 'No connected resources yet'}
              </p>
              {!normalizedQuery && (
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
