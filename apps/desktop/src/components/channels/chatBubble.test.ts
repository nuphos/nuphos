import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { themes } from '../../../../../packages/design-tokens/src/tokens.mjs'

type Rgb = [number, number, number]

const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8')

/** The fill's token and opacity from a `.chat-bubble-mine` rule in index.css. */
function fill(selector: string): { token: string; alpha: number } {
  const match = new RegExp(
    `${selector.replace(/\./g, '\\.')} \\{\\s*background-color: rgba\\(var\\(--color-([\\w-]+)\\), ([\\d.]+)\\)`,
  ).exec(css)

  assert.ok(match, `missing ${selector} in index.css`)

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
  const cases = [
    { name: 'dark', theme: themes.dark, rule: fill('  .chat-bubble-mine') },
    { name: 'light', theme: themes.light, rule: fill('html.light .chat-bubble-mine') },
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
