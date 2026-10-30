import { Dialog } from '@base-ui/react/dialog'
import { useId, useRef, useState } from 'react'

import { t } from '../../../i18n'

import { HOME_CARD_FILTERS } from './homeCardCatalog'
import { GalleryFooter } from './homeGalleryFooter'
import { moveTileFocus } from './homeGalleryKeys'
import { GalleryCards, GalleryHeader, GalleryPanels, GalleryRail } from './homeGalleryParts'

import type { HomeCardEntry, HomeCardFilter, HomeCardKind } from './homeCardCatalog'
import type { HomeLayout, HomePanel } from '../../../types/team.ts'

const POPUP =
  '@container flex h-[min(640px,calc(100vh-120px))] w-full max-w-[880px] flex-col overflow-hidden rounded-xl border border-main bg-elevated text-main shadow-[0_18px_50px_#00000066] outline-none transition-[opacity,transform] duration-[var(--modal-open-dur)] ease-[var(--modal-ease)] data-[ending-style]:scale-[var(--modal-scale-close)] data-[ending-style]:opacity-0 data-[ending-style]:duration-[var(--modal-close-dur)] data-[starting-style]:scale-[var(--modal-scale)] data-[starting-style]:opacity-0 motion-reduce:transition-none'

/**
 * Every kind of home card, to add from: a search over titles, descriptions
 * and keywords, category tabs, and a tile per kind with its action.
 * Dashboard panels are picked in a view of their own, which Back or Esc
 * leaves. Arrow keys move between the tabs and between the tiles, Down or
 * Enter in the search reaches the first tile, and Esc closes. Resetting to
 * the team default asks first.
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
  onAdd: (kind: HomeCardKind) => void
  /** Takes off a kind that is on or off, such as team activity. */
  onRemove: (kind: HomeCardKind) => void
  onTogglePanel: (pin: HomePanel) => void
  onReset: () => void
  onSetTeamDefault: () => void
}) {
  const [category, setCategory] = useState<HomeCardFilter>('all')
  const [query, setQuery] = useState('')
  const [picking, setPicking] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const tabsId = useId()

  const setOpen = (next: boolean) => {
    if (!next) {
      setQuery('')
      setCategory('all')
      setPicking(false)
    }
    onOpenChange(next)
  }
  const add = (card: HomeCardEntry) => {
    if (card.add === 'pick') setPicking(true)
    else onAdd(card.kind)
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next, details) => {
        // Esc in the panel picker goes back to the cards rather than closing.
        if (!next && picking && details.reason === 'escape-key') setPicking(false)
        else setOpen(next)
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[1000] bg-black/50 transition-opacity duration-[var(--modal-open-dur)] ease-[var(--modal-ease)] data-[ending-style]:opacity-0 data-[ending-style]:duration-[var(--modal-close-dur)] data-[starting-style]:opacity-0 motion-reduce:transition-none" />
        <Dialog.Viewport className="titlebar-no-drag fixed inset-0 z-[1001] flex items-start justify-center px-4 pt-[min(10vh,96px)] pb-6">
          <Dialog.Popup initialFocus={searchRef} className={POPUP}>
            <GalleryHeader />
            <div className="flex min-h-0 flex-1 flex-col @2xl:flex-row">
              <GalleryRail
                tabsId={tabsId}
                searchRef={searchRef}
                query={query}
                onQuery={(next) => {
                  setQuery(next)
                  setPicking(false)
                }}
                onSearchDown={() =>
                  listRef.current?.querySelector<HTMLElement>('[data-tile]')?.focus()
                }
                category={category}
                onCategory={(next) => {
                  setCategory(next)
                  setPicking(false)
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
                {picking ? (
                  <GalleryPanels
                    teamId={teamId}
                    selected={layout.panels}
                    onToggle={onTogglePanel}
                    onBack={() => setPicking(false)}
                  />
                ) : (
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
                    onRemove={(card) => onRemove(card.kind)}
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
