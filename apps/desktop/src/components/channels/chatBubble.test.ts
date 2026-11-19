import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { themes } from '../../../../../packages/design-tokens/src/tokens.mjs'

type Rgb = [number, number, number]

const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8')

/** The declarations of the first `selector { ... }` rule in index.css. */
function block(selector: string): string {
  const start = css.indexOf(`${selector} {`)

  assert.notEqual(start, -1, `missing ${selector} in index.css`)

  return css.slice(start, css.indexOf('}', start))
}

/**
 * Your bubble's fill, as its token and opacity. The bubble keeps
 * .user-message-bubble, which pins the text tokens to white, so the rule must
 * hand the theme's text color back before the fill can use it.
 */
function mineFill(): { token: string; alpha: number } {
  const rule = block('html .user-message-bubble.chat-bubble-mine')
  const match = /background-color: rgba\(var\(--color-([\w-]+)\), ([\d.]+)\)/.exec(rule)

  assert.ok(match, 'your bubble has no token fill')
  assert.match(rule, /--color-text-primary: var\(--theme-text-primary\)/)
  assert.match(css, /html \{\s*--theme-text-primary: var\(--color-text-primary\);/)

  return { token: match[1].replace('-', '.'), alpha: Number(match[2]) }
}

const hex = (value: unknown): Rgb => {
  const text = String(value)

  return [1, 3, 5].map((i) => Number.parseInt(text.slice(i, i + 2), 16)) as Rgb
}
const over = (top: Rgb, alpha: number, base: Rgb): Rgb =>
  top.map((c, i) => c * alpha + base[i] * (1 - alpha)) as Rgb
const luminance = (rgb: Rgb) => {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255

    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })

  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)

  return (hi + 0.05) / (lo + 0.05)
}

test('your chat bubble stands apart from an agent bubble and keeps its text readable (WCAG AA)', () => {
  // One rule for both themes: the light theme has no override of its own.
  assert.ok(!css.includes('html.light .chat-bubble-mine'), 'a light-only override is back')

  const mine = mineFill()
  const cases = [
    { name: 'dark', theme: themes.dark, rule: mine },
    { name: 'light', theme: themes.light, rule: mine },
  ] as const

  for (const { name, theme, rule } of cases) {
    const agent = theme['state.selected'] as { alpha: number }

    assert.ok(rule.alpha > agent.alpha, `${name}: ${rule.alpha} is no further than an agent's`)
    for (const surface of ['surface.canvas', 'surface.sheet', 'surface.raised'] as const) {
      const bubble = over(
        hex(theme[rule.token as keyof typeof theme]),
        rule.alpha,
        hex(theme[surface]),
      )
      const ratio = contrast(hex(theme['text.primary']), bubble)

      assert.ok(ratio >= 4.5, `${name} on ${surface}: ${ratio.toFixed(2)}:1`)
    }
  }
})
