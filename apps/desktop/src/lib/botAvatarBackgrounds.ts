import { t } from '../i18n'

// The tints a Bot's character may sit on, as the backend stores them
// (apps/backend/src/lib/agent/bot-avatars.ts). `none` (or unset) is a white disc.
export const BOT_AVATAR_BACKGROUNDS = [
  'none',
  'sand',
  'peach',
  'rose',
  'lilac',
  'sky',
  'mint',
  'sage',
  'slate',
] as const

export type BotAvatarBackground = (typeof BOT_AVATAR_BACKGROUNDS)[number]

/** A stored tint as a picker value: unset or unknown to this build is None. */
export function botAvatarBackground(name: string | null | undefined): BotAvatarBackground {
  return BOT_AVATAR_BACKGROUNDS.find((known) => known === name) ?? 'none'
}

/** The theme token a tint paints with; None, unset or a tint this build doesn't know is white. */
export function botAvatarBackgroundColor(name: string | null | undefined): string {
  const tint = botAvatarBackground(name)

  return `rgb(var(--color-avatar-${tint === 'none' ? 'white' : tint}))`
}

export function botAvatarBackgroundLabel(name: BotAvatarBackground): string {
  return {
    none: t('White'),
    sand: t('Sand'),
    peach: t('Peach'),
    rose: t('Rose'),
    lilac: t('Lilac'),
    sky: t('Sky'),
    mint: t('Mint'),
    sage: t('Sage'),
    slate: t('Slate'),
  }[name]
}
