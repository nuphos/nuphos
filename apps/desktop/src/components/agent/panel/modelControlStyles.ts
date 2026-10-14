import clsx from 'clsx'

/** Codex desktop's effort accent; light mode darkens the title text only, so it stays legible on white. */
export const ACCENT_TEXT = 'text-[#de9e99] [html.light_&]:text-[#c4706a]'
export const ACCENT_FILL = 'bg-[#de9e99]'

/** The composer's floating surfaces, drawn from the theme so light and dark both hold. */
export const SURFACE = clsx(
  'bg-[color-mix(in_srgb,rgb(var(--color-background-base))_96%,rgb(var(--color-text-base)))]',
  'shadow-[0_0_0_0.5px_rgba(var(--color-text-base),0.14),0_12px_32px_-8px_rgba(0,0,0,0.45)]',
  '[html.light_&]:shadow-[0_0_0_0.5px_rgba(var(--color-text-base),0.12),0_12px_32px_-8px_rgba(0,0,0,0.18)]',
)

/** Foreground at a given strength, the way Codex mixes its text tokens. */
export const FG_SECONDARY = 'text-[rgba(var(--color-text-base),0.65)]'
export const FG_TERTIARY = 'text-[rgba(var(--color-text-base),0.45)]'
export const HOVER_FILL = 'hover:bg-[rgba(var(--color-text-base),0.08)]'
