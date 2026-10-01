/**
 * Two-stop gradients taken from uiGradients (github.com/ghosh/uiGradients),
 * narrowed to pairs whose *both* stops clear 4.2:1 against the white initials
 * and whose hues sit far enough apart to tell two teams apart at 20px. Warm
 * ambers are absent on purpose: an orange dark enough for white text is a
 * brown. `avatarPalette.test.ts` re-derives the contrast, so an added swatch
 * that fails it breaks the build rather than shipping unreadable initials.
 */
export const AVATAR_GRADIENTS = [
  { name: 'Amin', from: '#8E2DE2', to: '#4A00E0' },
  { name: 'Kashmir', from: '#614385', to: '#516395' },
  { name: 'Very Blue', from: '#0575E6', to: '#021B79' },
  { name: 'Turquoise Flow', from: '#136A8A', to: '#267871' },
  { name: 'Under the Lake', from: '#093028', to: '#237A57' },
  { name: 'Army', from: '#414D0B', to: '#727A17' },
  { name: 'Sin City Red', from: '#ED213A', to: '#93291E' },
  { name: 'Alive', from: '#CB356B', to: '#BD3F32' },
  { name: 'Aubergine', from: '#AA076B', to: '#61045F' },
  { name: 'eXpresso', from: '#AD5389', to: '#3C1053' },
] as const

export type AvatarGradient = (typeof AVATAR_GRADIENTS)[number]

/** FNV-1a — cheap, and position-sensitive so "Acme Cloud" and "Cloud Acme"
 *  don't land on the same swatch the way a digit sum would. */
export function avatarGradient(name: string): AvatarGradient {
  let hash = 0x811c9dc5

  for (const ch of name.trim()) {
    hash ^= ch.codePointAt(0)!
    hash = Math.imul(hash, 0x01000193)
  }

  return AVATAR_GRADIENTS[(hash >>> 0) % AVATAR_GRADIENTS.length]!
}
