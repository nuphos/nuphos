// Shared DOM/color scanning used by both the "on this page" list and inspect
// mode: build a value→token reverse index, and sample an element's colors.

import { parseRgbFunc } from './colorMath'
import { resolveComputed } from './registry'

import type { RegistrySnapshot } from './types'

export const COLOR_CSS_PROPS = [
  'color',
  'background-color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'outline-color',
  'fill',
  'stroke',
] as const

// Reverse index: resolved "r, g, b" → token names sharing that value. Multiple
// tokens frequently collide on one value (e.g. several whites in light mode);
// we keep them all and let the UI surface the ambiguity.
export function buildValueIndex(registry: RegistrySnapshot): Map<string, string[]> {
  const index = new Map<string, string[]>()

  for (const name of registry.order) {
    const def = registry.tokens.get(name)

    if (!def || (def.kind !== 'triple' && def.kind !== 'ref')) continue
    const value = resolveComputed(name) // resolves var() to a final triple
    const parts = value.split(',').map((s) => s.trim())

    if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) continue
    const key = `${String(parseInt(parts[0], 10))}, ${String(parseInt(parts[1], 10))}, ${String(parseInt(parts[2], 10))}`
    const arr = index.get(key)

    if (arr) arr.push(name)
    else index.set(key, [name])
  }

  return index
}

export type ElementSample = {
  tokens: Set<string>
  skipped: number // opacity-modified color samples that couldn't be matched
}

export function sampleElement(el: Element, index: Map<string, string[]>): ElementSample {
  const cs = getComputedStyle(el)
  const isSvg = el instanceof SVGElement
  const tokens = new Set<string>()
  let skipped = 0

  for (const prop of COLOR_CSS_PROPS) {
    // `fill`/`stroke` default to opaque black on HTML elements — only meaningful
    // on SVG, so skip them elsewhere to avoid false black matches.
    if ((prop === 'fill' || prop === 'stroke') && !isSvg) continue
    const raw = cs.getPropertyValue(prop)

    if (!raw) continue
    const parsed = parseRgbFunc(raw)

    if (!parsed) continue
    if (parsed.a >= 0.999) {
      const key = `${String(Math.round(parsed.r))}, ${String(Math.round(parsed.g))}, ${String(Math.round(parsed.b))}`
      const names = index.get(key)

      if (names) names.forEach((n) => tokens.add(n))
    } else if (parsed.a > 0.001) {
      skipped++
    }
  }

  return { tokens, skipped }
}

export function describeElement(el: Element): string {
  const tag = el.tagName.toLowerCase()
  const id = el.id ? `#${el.id}` : ''
  const cls =
    typeof el.className === 'string' && el.className.trim()
      ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`
      : ''

  return `${tag}${id}${cls}`
}
