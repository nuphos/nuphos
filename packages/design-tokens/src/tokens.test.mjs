import assert from 'node:assert/strict'
import { test } from 'node:test'

import { cssValue, cssVariable, hexToChannels, themes } from './tokens.mjs'
import { tokenColors, tokenVariables } from './tailwind.mjs'

const HEX = /^#[0-9A-F]{6}$/

test('both themes define exactly the same tokens', () => {
  assert.deepEqual(Object.keys(themes.dark).sort(), Object.keys(themes.light).sort())
})

test('every token is uppercase hex, or hex with an alpha between 0 and 1', () => {
  for (const theme of Object.values(themes)) {
    for (const [name, value] of Object.entries(theme)) {
      const hex = typeof value === 'object' ? value.color : value

      assert.match(hex, HEX, name)
      if (typeof value === 'object') assert.ok(value.alpha > 0 && value.alpha < 1, name)
    }
  }
})

test('token names are group.key, which Tailwind nests into classes', () => {
  for (const name of Object.keys(themes.light)) assert.match(name, /^[a-z]+\.[a-z0-9]+$/, name)
})

/** WCAG relative luminance and contrast ratio. */
function contrast(a, b) {
  const luminance = (hex) => {
    const [r, g, bl] = hexToChannels(hex)
      .split(', ')
      .map((c) => {
        const s = Number(c) / 255

        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      })

    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)

  return (hi + 0.05) / (lo + 0.05)
}

test('every text level stays readable on every opaque surface (WCAG AA, 4.5:1)', () => {
  for (const [themeName, theme] of Object.entries(themes)) {
    for (const surface of ['surface.canvas', 'surface.sheet', 'surface.raised', 'surface.sunken']) {
      for (const text of ['text.primary', 'text.secondary', 'text.tertiary']) {
        const ratio = contrast(theme[text], theme[surface])

        assert.ok(ratio >= 4.5, `${themeName}: ${text} on ${surface} is ${ratio.toFixed(2)}:1`)
      }
    }
  }
})

/** A translucent state token laid over an opaque surface, as hex. */
function over(state, surface) {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(state.color.slice(i, i + 2), 16))
  const base = [1, 3, 5].map((i) => Number.parseInt(surface.slice(i, i + 2), 16))
  const mixed = [r, g, b].map((c, i) => Math.round(c * state.alpha + base[i] * (1 - state.alpha)))

  return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}

test('text stays readable on hovered and selected rows of the canvas and sheet', () => {
  for (const [themeName, theme] of Object.entries(themes)) {
    for (const surface of ['surface.canvas', 'surface.sheet']) {
      for (const state of ['state.hover', 'state.selected']) {
        const background = over(theme[state], theme[surface])

        for (const text of ['text.primary', 'text.secondary', 'text.tertiary']) {
          const ratio = contrast(theme[text], background)

          assert.ok(
            ratio >= 4.5,
            `${themeName}: ${text} on ${state} over ${surface} is ${ratio.toFixed(2)}:1`,
          )
        }
      }
    }
  }
})

test('status colors read as text on every opaque surface (WCAG AA, 4.5:1)', () => {
  for (const [themeName, theme] of Object.entries(themes)) {
    for (const surface of ['surface.canvas', 'surface.sheet', 'surface.raised', 'surface.sunken']) {
      for (const status of [
        'status.success',
        'status.warning',
        'status.danger',
        'status.attention',
      ]) {
        const ratio = contrast(theme[status], theme[surface])

        assert.ok(ratio >= 4.5, `${themeName}: ${status} on ${surface} is ${ratio.toFixed(2)}:1`)
      }
    }
  }
})

test('an attention badge keeps its count readable', () => {
  for (const theme of Object.values(themes)) {
    assert.ok(contrast(theme['status.attention'], theme['text.inverse']) >= 4.5)
  }
})

test('the primary action keeps its label readable', () => {
  for (const theme of Object.values(themes)) {
    assert.ok(contrast(theme['action.primary'], theme['text.inverse']) >= 4.5)
  }
})

test('conversions produce what Tailwind and CSS expect', () => {
  assert.equal(cssVariable('surface.canvas'), '--color-surface-canvas')
  assert.equal(hexToChannels('#F5F4F2'), '245, 244, 242')
  assert.equal(cssValue({ color: '#1C1A17', alpha: 0.04 }), 'rgba(28, 26, 23, 0.04)')
})

test('Tailwind gets a nested color and a variable for every token', () => {
  const colors = tokenColors()
  const variables = tokenVariables({ light: 'html.light', dark: 'html' })

  assert.equal(colors.state.hover, 'var(--color-state-hover)')
  assert.equal(colors.data['1']({ opacityValue: '0.4' }), 'rgba(var(--color-data-1), 0.4)')
  assert.equal(variables.html['--color-surface-canvas'], '20, 19, 18')
  assert.equal(variables['html.light']['--color-state-hover'], 'rgba(28, 26, 23, 0.04)')
})
