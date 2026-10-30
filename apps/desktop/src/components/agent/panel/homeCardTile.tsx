import clsx from 'clsx'
import { Check } from 'lucide-react'
import { useId } from 'react'

import { t } from '../../../i18n'
import { Button } from '../../ui/button'

import { GRID_COLUMNS, cardsOnHome } from './homeCardCatalog'

import type { HomeCardEntry } from './homeCardCatalog'
import type { HomeLayout } from '../../../types/team.ts'
import type { ReactNode } from 'react'

/** What a tile says about the cards of its kind on the home page, if anything. */
function tileStatus(card: HomeCardEntry, count: number): string | null {
  if (count === 0) return null
  if (card.add === 'once') return t('On home')

  return count === 1 ? t('1 on home') : t('{n} on home', { n: count })
}

/** A tile's button: Remove for a kind that is on, Choose panels for dashboards, Add otherwise. */
function tileAction(card: HomeCardEntry, removes: boolean): { text: string; label: string } {
  if (card.add === 'pick') return { text: t('Choose panels'), label: t('Choose panels') }
  if (removes) return { text: t('Remove'), label: t('Remove {card}', { card: card.title }) }

  return { text: t('Add'), label: t('Add {card}', { card: card.title }) }
}

/**
 * One kind of card in the gallery: a preview (its icon without one), its
 * title and what it shows, how many are on the home page, and its action. A
 * kind that is on or off offers Remove once added; others can always be added
 * again, and dashboard panels open their picker. A kind that cannot be added
 * now stays focusable so its reason can be read.
 */
export function GalleryTile({
  card,
  layout,
  preview,
  unavailable,
  onAdd,
  onRemove,
}: {
  card: HomeCardEntry
  layout: HomeLayout
  preview?: ReactNode
  /** Why the kind cannot be added now, if it cannot. */
  unavailable?: string
  onAdd: () => void
  onRemove: () => void
}) {
  const descriptionId = useId()
  const Icon = card.icon
  const count = cardsOnHome(layout, card.kind)
  const removes = card.add === 'once' && count > 0
  const action = tileAction(card, removes)
  const status = unavailable ?? tileStatus(card, count)

  return (
    <li
      className={clsx(
        'flex flex-col overflow-hidden rounded-lg border border-main bg-surface/40 transition-colors hover:border-zGray-700 focus-within:border-zGray-700',
        // A full-width card gets the full row, so its preview stays readable.
        card.size.w === GRID_COLUMNS && '@lg:col-span-2',
      )}
    >
      <div
        aria-hidden
        className="relative h-[132px] overflow-hidden border-b border-main bg-zGray-900/40"
      >
        {preview ?? (
          <div className="flex h-full items-center justify-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-zGray-800/60 text-secondary">
              <Icon className="h-5 w-5" strokeWidth={1.6} />
            </span>
          </div>
        )}
      </div>
      <div className="flex flex-1 items-start gap-2.5 p-3">
        <Icon className="mt-0.5 h-3.5 w-3.5 flex-none text-secondary" strokeWidth={1.8} />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] text-main">{card.title}</div>
          <p id={descriptionId} className="mt-0.5 text-[12px] leading-snug text-tertiary">
            {card.description}
          </p>
          {status && (
            <div className="mt-1.5 flex items-center gap-1 text-[11.5px] text-secondary">
              {!unavailable && <Check className="h-3 w-3 text-success" strokeWidth={2.2} />}
              {status}
            </div>
          )}
        </div>
        <Button
          data-tile=""
          variant={removes ? 'ghost' : 'secondary'}
          size="sm"
          disabled={Boolean(unavailable)}
          focusableWhenDisabled
          aria-describedby={descriptionId}
          aria-label={action.label}
          onClick={removes ? onRemove : onAdd}
          className="flex-none"
        >
          {action.text}
        </Button>
      </div>
    </li>
  )
}
