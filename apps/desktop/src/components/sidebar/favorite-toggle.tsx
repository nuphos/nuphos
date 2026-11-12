import clsx from 'clsx'
import { Pin, Star } from 'lucide-react'

import { t } from '../../i18n'

/**
 * Hover-revealed pin or star, so favoriting is discoverable without knowing about the
 * right-click menu, and so a Favorites row can remove itself in place.
 */
export function FavoriteToggle({
  favorited,
  label,
  onToggle,
  pin = false,
}: {
  pin?: boolean
  favorited: boolean
  label: string
  onToggle: () => void
}) {
  const Icon = pin ? Pin : Star
  const pinLabel = favorited ? t('Unpin Bot') : t('Pin Bot')

  return (
    <span
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        event.stopPropagation()
        onToggle()
      }}
      onPointerDown={(event) => event.stopPropagation()}
      aria-label={
        pin
          ? pinLabel
          : favorited
            ? t('Remove {label} from Favorites', { label })
            : t('Add {label} to Favorites', { label })
      }
      title={pin ? pinLabel : favorited ? t('Remove from Favorites') : t('Add to Favorites')}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      className={clsx(
        'flex-shrink-0 inline-flex items-center justify-center w-5 h-5 rounded hover:bg-[var(--sidebar-overlay-hover)]',
        favorited && !pin ? 'text-warning hover:text-warning/70' : 'text-tertiary hover:text-main',
      )}
    >
      <Icon className="w-3.5 h-3.5" strokeWidth={1.8} fill={favorited ? 'currentColor' : 'none'} />
    </span>
  )
}
