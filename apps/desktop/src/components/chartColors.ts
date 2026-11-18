// One data hue (design tokens, #1632): further series step down in opacity
// before falling back to the text tones, so charts read as one family.
export const SERIES_COLORS = [
  'rgb(var(--color-data-1))',
  'rgba(var(--color-data-1), 0.6)',
  'rgba(var(--color-data-1), 0.35)',
  'rgb(var(--color-text-secondary))',
  'rgb(var(--color-text-tertiary))',
]
