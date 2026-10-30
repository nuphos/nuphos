import { t } from '../../i18n'

export function favoriteToggleAriaLabel(
  chatRow: boolean,
  favorited: boolean,
  label: string,
): string {
  if (chatRow) return favorited ? t('Unpin {label}', { label }) : t('Pin {label}', { label })

  return favorited
    ? t('Remove {label} from Favorites', { label })
    : t('Add {label} to Favorites', { label })
}

// These titles double as section ids (chat-sections, Sidebar) and collapse-state
// keys, so they are translated only where they are shown.
export const SECTION_LABELS: Record<string, string> = {
  Channels: t('Channels'),
  Agents: t('Agents'),
  Pinned: t('Pinned'),
  Favorites: t('Favorites'),
}
