import { cssValue, cssVariable, isTranslucent, themes } from './tokens.mjs'

/**
 * Tailwind colors for every token, nested by group:
 * `surface.canvas` → `bg-surface-canvas`, `text.primary` → `text-text-primary`.
 * Opaque tokens accept opacity modifiers (`bg-data-1/40`); translucent ones don't.
 */
export function tokenColors() {
  /** @type {Record<string, Record<string, unknown>>} */
  const colors = {}

  for (const [name, value] of Object.entries(themes.light)) {
    const [group, key] = name.split('.')
    const variable = cssVariable(name)

    colors[group] ??= {}
    colors[group][key] = isTranslucent(value)
      ? `var(${variable})`
      : ({ opacityValue }) =>
          opacityValue === undefined
            ? `rgb(var(${variable}))`
            : `rgba(var(${variable}), ${opacityValue})`
  }

  return colors
}

/**
 * Declares each token's CSS variable per theme. The selectors say where each
 * theme applies, since apps switch themes differently (Desktop defaults to dark
 * on `html` and adds `html.light`).
 */
export function tokenVariables({ light, dark }) {
  const declarations = (theme) =>
    Object.fromEntries(
      Object.entries(theme).map(([name, value]) => [cssVariable(name), cssValue(value)]),
    )

  return { [dark]: declarations(themes.dark), [light]: declarations(themes.light) }
}
