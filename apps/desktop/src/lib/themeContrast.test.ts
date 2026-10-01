import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

type Rgb = readonly [number, number, number]

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

function cssBlock(selector: string): string {
  const selectorIndex = css.indexOf(selector)

  assert.notEqual(selectorIndex, -1, `missing ${selector} in index.css`)

  const start = css.indexOf('{', selectorIndex)
  let depth = 0

  for (let index = start; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1
    if (css[index] === '}') depth -= 1
    if (depth === 0) return css.slice(start + 1, index)
  }

  throw new Error(`unterminated ${selector} block in index.css`)
}

function declarations(source: string): Map<string, string> {
  const result = new Map<string, string>()
  const [beforeFirstComment = '', ...commentChunks] = source.split('/*')
  let uncommented = beforeFirstComment

  for (const chunk of commentChunks) {
    const commentEnd = chunk.indexOf('*/')

    assert.notEqual(commentEnd, -1, 'unterminated CSS comment')
    uncommented += chunk.slice(commentEnd + 2)
  }

  for (const declaration of uncommented.split(';')) {
    const separator = declaration.indexOf(':')
    const name = declaration.slice(0, separator).trim()

    if (separator > 0 && name.startsWith('--')) {
      result.set(name, declaration.slice(separator + 1).trim())
    }
  }

  return result
}

function resolveColor(tokens: Map<string, string>, name: string, seen = new Set<string>()): Rgb {
  assert.ok(!seen.has(name), `cyclic color token: ${[...seen, name].join(' → ')}`)
  seen.add(name)

  const value = tokens.get(name)

  assert.ok(value, `missing color token: ${name}`)

  const reference = value.match(/^var\((--[\w-]+)\)$/)

  if (reference) {
    const referencedName = reference[1]

    assert.ok(referencedName)

    return resolveColor(tokens, referencedName, seen)
  }

  const channels = value.match(/^(\d+),\s*(\d+),\s*(\d+)$/)

  assert.ok(channels, `${name} is not an RGB triplet: ${value}`)

  const [, red, green, blue] = channels

  assert.ok(red && green && blue)

  return [Number(red), Number(green), Number(blue)]
}

function linearChannel(channel: number): number {
  const value = channel / 255

  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function luminance(rgb: Rgb): number {
  const [red, green, blue] = rgb

  return 0.2126 * linearChannel(red) + 0.7152 * linearChannel(green) + 0.0722 * linearChannel(blue)
}

function contrast(first: Rgb, second: Rgb): number {
  const firstLuminance = luminance(first)
  const secondLuminance = luminance(second)
  const lighter = Math.max(firstLuminance, secondLuminance)
  const darker = Math.min(firstLuminance, secondLuminance)

  return (lighter + 0.05) / (darker + 0.05)
}

function tint(foreground: Rgb, background: Rgb, alpha: number): Rgb {
  const channel = (index: 0 | 1 | 2) =>
    Math.round(foreground[index] * alpha + background[index] * (1 - alpha))

  return [channel(0), channel(1), channel(2)]
}

const rootTokens = declarations(cssBlock(':root'))
const darkTokens = new Map([...rootTokens, ...declarations(cssBlock('html {'))])
const lightTokens = new Map([...darkTokens, ...declarations(cssBlock('html.light'))])

for (const [theme, tokens] of [
  ['dark', darkTokens],
  ['light', lightTokens],
] as const) {
  test(`${theme} theme text tokens meet AA contrast`, () => {
    const background = resolveColor(tokens, '--color-background-base')
    const foregrounds = [
      '--color-text-base',
      '--color-text-secondary',
      '--color-text-tertiary',
      '--color-success',
      '--color-error',
      '--color-warning',
      '--color-zViolet-accent',
    ]

    for (const name of foregrounds) {
      const ratio = contrast(resolveColor(tokens, name), background)

      assert.ok(ratio >= 4.5, `${name} is only ${ratio.toFixed(2)}:1 on ${theme} canvas`)
    }
  })

  test(`${theme} theme status text remains AA on a 10% self tint`, () => {
    const background = resolveColor(tokens, '--color-background-base')
    const foregrounds = [
      '--color-success',
      '--color-error',
      '--color-warning',
      '--color-zViolet-accent',
    ]

    for (const name of foregrounds) {
      const foreground = resolveColor(tokens, name)
      const ratio = contrast(foreground, tint(foreground, background, 0.1))

      assert.ok(ratio >= 4.5, `${name} is only ${ratio.toFixed(2)}:1 on its ${theme} tint`)
    }
  })
}

test('user message bubbles keep white text readable in both themes', () => {
  const white: Rgb = [255, 255, 255]

  assert.ok(contrast(white, [46, 46, 46]) >= 4.5)
  assert.ok(contrast(white, [0, 0, 0]) >= 4.5)
})
