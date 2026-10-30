import { Dialog } from '@base-ui/react/dialog'
import clsx from 'clsx'
import { ArrowLeft, Plus, Search, SearchX, X } from 'lucide-react'
import { useRef } from 'react'

import { t } from '../../../i18n'
import { Button } from '../../ui/button'
import { InputGroup, InputGroupInput } from '../../ui/input-group'

import { HOME_CARD_CATEGORIES, HOME_CARD_FILTERS, findCards } from './homeCardCatalog'
import { CardPreview } from './homeCardPreviews'
import { GalleryTile } from './homeCardTile'
import { tabStep, useTabsOrientation } from './homeGalleryKeys'
import { GalleryPanelPicker } from './homeGalleryPanels'

import type { HomeCardEntry, HomeCardFilter } from './homeCardCatalog'
import type { HomeLayout, HomePanel } from '../../../types/team.ts'
import type { RefObject } from 'react'

/** The search and the category tabs, down the side or across the top when narrow. */
export function GalleryRail({
  tabsId,
  searchRef,
  query,
  onQuery,
  onSearchDown,
  category,
  onCategory,
}: {
  /** Prefix of the tab ids; the panel they control is `${tabsId}-panel`. */
  tabsId: string
  searchRef: RefObject<HTMLInputElement | null>
  query: string
  onQuery: (query: string) => void
  /** Down or Enter in the search, to move into the cards. */
  onSearchDown: () => void
  category: HomeCardFilter
  onCategory: (category: HomeCardFilter) => void
}) {
  const tabsRef = useRef<HTMLDivElement>(null)
  const orientation = useTabsOrientation(tabsRef)
  const found = findCards(query, category).length
  let status = ''

  // Read out as the search narrows the cards, so the count is heard as well as seen.
  if (query.trim() && found === 0) status = t('No cards match “{query}”', { query: query.trim() })
  else if (query.trim()) status = found === 1 ? t('1 card') : t('{n} cards', { n: found })

  return (
    <div className="flex shrink-0 flex-col gap-2 border-b border-main p-3 @2xl:w-[196px] @2xl:border-b-0 @2xl:border-r">
      <InputGroup
        render={<label />}
        className="flex h-8 items-center gap-2 rounded-md border border-main bg-surface px-2 text-[13px] focus-within:border-zViolet-500"
      >
        <Search className="h-3.5 w-3.5 flex-none text-tertiary" strokeWidth={1.8} />
        <InputGroupInput
          ref={searchRef}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'Enter') return
            e.preventDefault()
            onSearchDown()
          }}
          placeholder={t('Search cards')}
          aria-label={t('Search cards')}
          className="text-main placeholder:text-tertiary"
        />
      </InputGroup>
      <div
        ref={tabsRef}
        role="tablist"
        aria-label={t('Card categories')}
        aria-orientation={orientation}
        className="flex gap-1 overflow-x-auto scrollbar-thin @2xl:flex-col"
      >
        {HOME_CARD_FILTERS.map((c, i) => {
          const selected = c.value === category

          return (
            <button
              key={c.value}
              id={`${tabsId}-${String(i)}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${tabsId}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onCategory(c.value)}
              onKeyDown={(e) => {
                const next = tabStep(e.key, i, HOME_CARD_FILTERS.length)

                if (next === null) return
                e.preventDefault()
                onCategory(HOME_CARD_FILTERS[next]?.value ?? 'all')
                document.getElementById(`${tabsId}-${String(next)}`)?.focus()
              }}
              className={clsx(
                'flex h-8 flex-none items-center gap-2 rounded-md px-2.5 text-left text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-zViolet-accent',
                selected
                  ? 'bg-zGray-800 text-main'
                  : 'text-secondary hover:bg-zGray-800/60 hover:text-main',
              )}
            >
              <span className="flex-1 whitespace-nowrap">{c.label}</span>
              <span className="text-[11px] text-tertiary tabular-nums">
                {findCards(query, c.value).length}
              </span>
            </button>
          )
        })}
      </div>
      <div role="status" aria-live="polite" className="sr-only">
        {status}
      </div>
    </div>
  )
}

/** Shown when the search matches no kind of card. */
function NoMatch({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 py-10 text-center">
      <SearchX className="h-5 w-5 text-tertiary" strokeWidth={1.6} />
      <div className="text-[13px] text-secondary">
        {t('No cards match “{query}”', { query: query.trim() })}
      </div>
      <Button variant="ghost" size="sm" onClick={onClear}>
        {t('Clear search')}
      </Button>
    </div>
  )
}

/**
 * The tiles for `category` that match `query`, under a heading per category
 * when showing all of them.
 */
export function GalleryCards({
  category,
  query,
  layout,
  unavailable,
  onAdd,
  onRemove,
  onClearSearch,
}: {
  category: HomeCardFilter
  query: string
  layout: HomeLayout
  /** Why a kind cannot be added now, if it cannot. */
  unavailable: (card: HomeCardEntry) => string | undefined
  onAdd: (card: HomeCardEntry) => void
  onRemove: (card: HomeCardEntry) => void
  onClearSearch: () => void
}) {
  const cards = findCards(query, category)

  if (cards.length === 0) return <NoMatch query={query} onClear={onClearSearch} />
  const groups =
    category === 'all'
      ? HOME_CARD_CATEGORIES.map((c) => ({
          ...c,
          cards: cards.filter((card) => card.category === c.value),
        })).filter((g) => g.cards.length > 0)
      : [{ value: category, label: '', cards }]

  return (
    <>
      {groups.map((group) => (
        <section key={group.value} aria-label={group.label || undefined}>
          {group.label && (
            <h3 className="pb-2 pt-4 text-[11.5px] font-medium text-tertiary">{group.label}</h3>
          )}
          <ul className={clsx('grid gap-3 @lg:grid-cols-2', !group.label && 'pt-4')}>
            {group.cards.map((card) => (
              <GalleryTile
                key={card.kind}
                card={card}
                layout={layout}
                preview={<CardPreview kind={card.kind} />}
                unavailable={unavailable(card)}
                onAdd={() => onAdd(card)}
                onRemove={() => onRemove(card)}
              />
            ))}
          </ul>
        </section>
      ))}
    </>
  )
}

/** The dashboard panel picker in place of the cards, with a way back to them. */
export function GalleryPanels({
  teamId,
  selected,
  onToggle,
  onBack,
}: {
  teamId: string
  selected: HomePanel[]
  onToggle: (pin: HomePanel) => void
  onBack: () => void
}) {
  return (
    <div className="pt-3">
      <Button variant="ghost" size="sm" autoFocus onClick={onBack} className="-ml-2">
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.8} />
        {t('All cards')}
      </Button>
      <h3 className="mt-2 text-[13px] font-medium text-main">{t('Dashboard panels')}</h3>
      <p className="mb-3 mt-0.5 text-[12px] text-tertiary">
        {t('Each panel you check is pinned to the home page as a card of its own.')}
      </p>
      <GalleryPanelPicker teamId={teamId} selected={selected} onToggle={onToggle} />
    </div>
  )
}

/**
 * The way into the gallery at the end of the cards: always there when there
 * are none, otherwise shown while the cards are hovered or it has focus.
 */
export function AddCardButton({ subtle, onClick }: { subtle: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-zGray-800 text-[12px] text-tertiary outline-none transition-[opacity,color,border-color] hover:border-zGray-700 hover:text-main focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-zViolet-accent motion-reduce:transition-none',
        subtle && 'opacity-0 group-hover/home:opacity-100',
      )}
    >
      <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
      {t('Add card')}
    </button>
  )
}

/** The gallery's title, what it is for, and its close button. */
export function GalleryHeader() {
  return (
    <div className="flex shrink-0 items-start justify-between gap-4 border-b border-main px-5 py-3.5">
      <div className="min-w-0">
        <Dialog.Title className="text-[14px] font-medium">{t('Add cards')}</Dialog.Title>
        <Dialog.Description className="mt-0.5 text-[12px] text-secondary">
          {t('Pick what shows under the composer. Drag cards on the home page to arrange them.')}
        </Dialog.Description>
      </div>
      <Dialog.Close
        aria-label={t('Close')}
        className="-mr-1.5 rounded-md p-1 text-tertiary outline-none transition-colors hover:bg-zGray-800 hover:text-main focus-visible:ring-2 focus-visible:ring-zViolet-accent"
      >
        <X className="h-4 w-4" strokeWidth={1.8} />
      </Dialog.Close>
    </div>
  )
}
