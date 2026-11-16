import clsx from 'clsx'
import { ChevronDown, ChevronRight } from 'lucide-react'

import { t } from '../../i18n'

import { rowExpansion, toggleRowExpansion } from './row-expand'

import type { RowExpandActions, RowExpandInput } from './row-expand'
import type { Item } from './types'

function foldLabel(item: Item, expanded: boolean): string {
  if (item.project) return expanded ? t('Collapse') : t('Expand')

  return expanded ? t('Hide sub-agents') : t('Show sub-agents')
}

/** A parent row's one expand control, at its edge; see row-expand for what a click does. */
export function RowFoldToggle({
  item,
  row,
  ...actions
}: { item: Item; row: RowExpandInput } & RowExpandActions) {
  const expansion = rowExpansion(row)

  if (expansion === 'none') return null
  const expanded = expansion === 'expanded'

  return (
    <span
      role="button"
      aria-label={foldLabel(item, expanded)}
      title={foldLabel(item, expanded)}
      onClick={(e) => {
        e.stopPropagation()
        toggleRowExpansion(row, actions)
      }}
      className={clsx(
        'flex-shrink-0 items-center justify-center w-5 h-5 rounded text-tertiary hover:text-main hover:bg-[var(--sidebar-overlay-hover)]',
        // Shown at rest only when folded. Otherwise it takes no room until the
        // row is hovered or focused, like the row's hover actions, so a row
        // never ends in a blank gap.
        expansion === 'collapsed'
          ? 'inline-flex'
          : 'hidden group-hover:inline-flex group-focus-visible:inline-flex group-has-[:focus-visible]/row:inline-flex',
      )}
    >
      {expanded ? (
        <ChevronDown className="w-3.5 h-3.5" strokeWidth={1.8} />
      ) : (
        <ChevronRight className="w-3.5 h-3.5" strokeWidth={1.8} />
      )}
    </span>
  )
}
