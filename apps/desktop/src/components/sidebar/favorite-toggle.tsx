import clsx from 'clsx'
import { Star } from 'lucide-react'

import { t } from '../../i18n'
import { favoriteToggleTitle } from '../../lib/sidebarPinnedChats'

function favoriteToggleAriaLabel(chatRow: boolean, favorited: boolean, label: string): string {
  if (chatRow) return favorited ? t('Unpin {label}', { label }) : t('Pin {label}', { label })

  return favorited
    ? t('Remove {label} from Favorites', { label })
    : t('Add {label} to Favorites', { label })
}

/**
 * Hover-revealed pin toggle, so favoriting is discoverable without knowing
 * about the right-click menu, and so a Favorites row can unpin itself in place.
 */
export function FavoriteToggle({
  chatRow,
  favorited,
  label,
  onToggle,
}: {
  chatRow: boolean
  favorited: boolean
  label: string
  onToggle: () => void
}) {
  return (
    <span
      role="button"
      aria-label={favoriteToggleAriaLabel(chatRow, favorited, label)}
      title={favoriteToggleTitle(chatRow, favorited)}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      className={clsx(
        'flex-shrink-0 inline-flex items-center justify-center w-5 h-5 rounded hover:bg-[var(--sidebar-overlay-hover)]',
        favorited ? 'text-warning hover:text-warning/70' : 'text-tertiary hover:text-main',
      )}
    >
      <Star className="w-3.5 h-3.5" strokeWidth={1.8} fill={favorited ? 'currentColor' : 'none'} />
    </span>
  )
}
