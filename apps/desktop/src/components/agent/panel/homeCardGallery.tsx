import { Dialog } from '@base-ui/react/dialog'
import { useId, useRef, useState } from 'react'

import { t } from '../../../i18n'

import { HOME_CARD_FILTERS, catalogEntry } from './homeCardCatalog'
import { GalleryFooter } from './homeGalleryFooter'
import { focusTile, moveTileFocus, useAnnouncement } from './homeGalleryKeys'
import { GalleryCards, GalleryHeader, GalleryPanels, GalleryRail } from './homeGalleryParts'
import { GalleryGithubSetup } from './homeGallerySetup'

import type { HomeCardEntry, HomeCardFilter, HomeCardKind } from './homeCardCatalog'
import type { HomeGithubCard, HomeLayout, HomePanel } from '../../../types/team.ts'

const POPUP =
  '@container flex h-[min(640px,calc(100vh-120px))] w-full max-w-[880px] flex-col overflow-hidden rounded-xl border border-main bg-elevated text-main shadow-[0_18px_50px_#00000066] outline-none transition-[opacity,transform] duration-[var(--modal-open-dur)] ease-[var(--modal-ease)] data-[ending-style]:scale-[var(--modal-scale-close)] data-[ending-style]:opacity-0 data-[ending-style]:duration-[var(--modal-close-dur)] data-[starting-style]:scale-[var(--modal-scale)] data-[starting-style]:opacity-0 motion-reduce:transition-none'

/**
 * Every kind of home card, to add from: a search over titles, descriptions
 * and keywords, category tabs, and a tile per kind with its action.
 * Dashboard panels are picked, and a pull request or CI card is set up, in a
 * view of its own, which Back or Esc leaves, focus returning to its tile.
 * Adding keeps the gallery open, so several cards can be added at once, and
 * is announced politely. Arrow keys move between the tabs and between the
 * tiles, Down or Enter in the search reaches the first tile, and Esc closes.
 * Resetting to the team default asks first.
 */
export function HomeCardGallery({
  teamId,
  open,
  onOpenChange,
  layout,
  hasTeammates,
  customized,
  isTeamAdmin,
  onAdd,
  onRemove,
  onTogglePanel,
  onReset,
  onSetTeamDefault,
}: {
  teamId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  layout: HomeLayout
  /** Team activity shows only with someone else on the team. */
  hasTeammates: boolean
  /** Whether the member has a layout of their own to reset. */
  customized: boolean
  isTeamAdmin: boolean
  /** Adds a card of `kind`; a GitHub card comes with its repositories and statuses. */
  onAdd: (kind: HomeCardKind, github?: Pick<HomeGithubCard, 'repos' | 'statuses'>) => void
  /** Takes off a kind that is on or off, such as team activity. */
  onRemove: (kind: HomeCardKind) => void
  onTogglePanel: (pin: HomePanel) => void
  onReset: () => void
  onSetTeamDefault: () => void
}) {
  const [category, setCategory] = useState<HomeCardFilter>('all')
  const [query, setQuery] = useState('')
  // Which view shows beside the tabs: the cards, or setting up the kind picked.
  const [view, setView] = useState<'cards' | 'panel' | 'pulls' | 'ci'>('cards')
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const tabsId = useId()
  const [said, say] = useAnnouncement()
  const backTo = (kind: HomeCardKind) => {
    setView('cards')
    focusTile(listRef.current, kind)
  }
  const setOpen = (next: boolean) => {
    if (!next) {
      setQuery('')
      setCategory('all')
      setView('cards')
    }
    onOpenChange(next)
  }
  const add = (card: HomeCardEntry) => {
    if (card.kind === 'panel' || card.kind === 'pulls' || card.kind === 'ci') setView(card.kind)
    else {
      onAdd(card.kind)
      say(t('{card} added', { card: card.title }))
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next, details) => {
        // Esc while setting up a card goes back to the cards rather than closing.
        if (!next && view !== 'cards' && details.reason === 'escape-key') backTo(view)
        else setOpen(next)
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[1000] bg-black/50 transition-opacity duration-[var(--modal-open-dur)] ease-[var(--modal-ease)] data-[ending-style]:opacity-0 data-[ending-style]:duration-[var(--modal-close-dur)] data-[starting-style]:opacity-0 motion-reduce:transition-none" />
        <Dialog.Viewport className="titlebar-no-drag fixed inset-0 z-[1001] flex items-start justify-center px-4 pt-[min(10vh,96px)] pb-6">
          <Dialog.Popup initialFocus={searchRef} className={POPUP}>
            <GalleryHeader said={said} />
            <div className="flex min-h-0 flex-1 flex-col @2xl:flex-row">
              <GalleryRail
                tabsId={tabsId}
                searchRef={searchRef}
                query={query}
                onQuery={(next) => {
                  setQuery(next)
                  setView('cards')
                }}
                onSearchDown={() =>
                  listRef.current?.querySelector<HTMLElement>('[data-tile]')?.focus()
                }
                category={category}
                onCategory={(next) => {
                  setCategory(next)
                  setView('cards')
                }}
              />
              <div
                id={`${tabsId}-panel`}
                ref={listRef}
                role="tabpanel"
                aria-labelledby={`${tabsId}-${String(HOME_CARD_FILTERS.findIndex((c) => c.value === category))}`}
                onKeyDown={(e) => {
                  if (listRef.current && moveTileFocus(listRef.current, e.key)) e.preventDefault()
                }}
                className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-4 pb-4"
              >
                {view === 'panel' && (
                  <GalleryPanels
                    teamId={teamId}
                    selected={layout.panels}
                    onToggle={onTogglePanel}
                    onBack={() => backTo('panel')}
                  />
                )}
                {(view === 'pulls' || view === 'ci') && (
                  <GalleryGithubSetup
                    teamId={teamId}
                    kind={view}
                    onBack={() => backTo(view)}
                    onAdd={(setup) => {
                      onAdd(view, setup)
                      say(t('{card} added', { card: catalogEntry(view).title }))
                      backTo(view)
                    }}
                  />
                )}
                {view === 'cards' && (
                  <GalleryCards
                    category={category}
                    query={query}
                    layout={layout}
                    unavailable={(card) =>
                      card.kind === 'team' && !hasTeammates
                        ? t('Shows once someone else joins the team')
                        : undefined
                    }
                    onAdd={add}
                    onRemove={(card) => {
                      onRemove(card.kind)
                      say(t('{card} removed', { card: card.title }))
                    }}
                    onClearSearch={() => {
                      setQuery('')
                      searchRef.current?.focus()
                    }}
                  />
                )}
              </div>
            </div>
            <GalleryFooter
              customized={customized}
              isTeamAdmin={isTeamAdmin}
              onReset={onReset}
              onSetTeamDefault={onSetTeamDefault}
              onDone={() => setOpen(false)}
            />
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
