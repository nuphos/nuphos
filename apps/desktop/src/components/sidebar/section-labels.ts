import { t } from '../../i18n'

// These titles double as section ids (chat-sections, Sidebar) and collapse-state
// keys, so they are translated only where they are shown.
export const SECTION_LABELS: Record<string, string> = {
  Channels: t('Bots'),
  Agents: t('Agents'),
  Tasks: t('Tasks'),
  Favorites: t('Favorites'),
}
