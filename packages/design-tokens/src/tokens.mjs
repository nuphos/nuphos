/**
 * Semantic design tokens: named for what they do, never for how they look.
 *
 * This file is the single source for every platform. Desktop reads it through
 * `./tailwind.mjs`; web and mobile generators can read the same object later.
 *
 * Opaque colors are hex. A translucent state is `{ color, alpha }`: it tints
 * whatever surface it sits on, so one hover works on canvas, sheet and raised.
 */

/** @typedef {string | { color: string, alpha: number }} TokenValue */
/** @typedef {Record<string, TokenValue>} Theme */

/** @type {{ light: Theme, dark: Theme }} */
export const themes = {
  light: {
    // Surfaces, from the desk up. Matches nuphos.ai's light palette.
    'surface.canvas': '#F5F4F2',
    'surface.sheet': '#FCFBF9',
    'surface.raised': '#FFFFFE',
    'surface.sunken': '#EEECE8',

    'state.hover': { color: '#1C1A17', alpha: 0.04 },
    'state.selected': { color: '#1C1A17', alpha: 0.07 },

    'text.primary': '#1C1A17',
    'text.secondary': '#5C5852',
    'text.tertiary': '#69645D',
    'text.inverse': '#FCFBF9',

    // Lines belong to controls only; areas are separated by surfaces, not dividers.
    'line.control': '#E2DFDA',
    'line.focus': '#69645D',

    // The primary action is ink: no separate brand color competes with content.
    'action.primary': '#1C1A17',

    'status.success': '#2B7346',
    'status.warning': '#A04606',
    'status.danger': '#B91C1C',
    // Something needs the person's attention: unread counts, waiting questions.
    'status.attention': '#B83A0A',

    // Data series and heatmaps: one muted blue, intensity by opacity.
    'data.1': '#2F4F7F',
  },
  dark: {
    // As warm as the light theme, no warmer: it reads as black.
    'surface.canvas': '#141312',
    'surface.sheet': '#1A1917',
    'surface.raised': '#242321',
    'surface.sunken': '#272624',

    'state.hover': { color: '#FFFFFF', alpha: 0.05 },
    'state.selected': { color: '#FFFFFF', alpha: 0.08 },

    'text.primary': '#F2F0EC',
    'text.secondary': '#B8B4AD',
    'text.tertiary': '#A09C95',
    'text.inverse': '#1A1917',

    'line.control': '#33312E',
    'line.focus': '#A09C95',

    'action.primary': '#F2F0EC',

    'status.success': '#5FB57E',
    'status.warning': '#F5A623',
    'status.danger': '#EF6252',
    'status.attention': '#F47A3F',

    'data.1': '#7C9CCB',
  },
}

/** `surface.canvas` → `--color-surface-canvas`. */
export function cssVariable(name) {
  return `--color-${name.replaceAll('.', '-')}`
}

/** `#F5F4F2` → `245, 244, 242`, the channel form Tailwind's opacity modifier needs. */
export function hexToChannels(hex) {
  const value = Number.parseInt(hex.slice(1), 16)

  return [(value >> 16) & 255, (value >> 8) & 255, value & 255].join(', ')
}

/** Whether a token carries its own alpha, so opacity modifiers don't apply to it. */
export function isTranslucent(value) {
  return typeof value === 'object'
}

/** The CSS value a token's variable holds. */
export function cssValue(value) {
  return isTranslucent(value)
    ? `rgba(${hexToChannels(value.color)}, ${value.alpha})`
    : hexToChannels(value)
}
