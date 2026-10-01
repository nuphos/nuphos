// Reads the color-token catalog live from the CSSOM so it always matches
// index.css (never hardcoded). index.css defines the raw scale under `:root`,
// the dark semantic tokens under `html`, and the light overrides under
// `html.light`. Tailwind wraps everything in `@layer base`, so we recurse into
// grouping rules (layer/media/supports) to reach the style rules.

import type { RegistrySnapshot, Theme, TokenDef, TokenKind } from './types'

const DARK_SELECTORS = new Set([':root', 'html', ':root, html', 'html, :root'])

function classifyKind(value: string): TokenKind {
  const v = value.trim()

  if (/^\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}$/.test(v)) return 'triple'
  if (/\bvar\(/.test(v)) return 'ref'
  if (/^rgba?\(/i.test(v)) return 'rgba'

  return 'other'
}

function extractRefs(value: string): string[] {
  const refs: string[] = []
  const re = /var\((--[\w-]+)/g
  let m: RegExpExecArray | null

  while ((m = re.exec(value))) refs.push(m[1])

  return refs
}

// Palette-scale names look like `--color-zGray-900`, `--color-zViolet-accent`,
// `--color-zBlue-hover`. Everything else (`--color-background-base`,
// `--color-text-*`, `--color-appBg`, status colors) is semantic.
const RAW_RE = /^--color-[a-z]+[A-Z]\w*-(\d+|accent|hover|active)$/

function classifyGroup(name: string): 'raw' | 'semantic' {
  return RAW_RE.test(name) ? 'raw' : 'semantic'
}

type Visit = (selector: string, style: CSSStyleDeclaration) => void

function walkRules(rules: CSSRuleList, visit: Visit): void {
  for (const raw of Array.from(rules)) {
    const rule = raw as CSSStyleRule & { cssRules?: CSSRuleList }

    if (rule.selectorText && rule.style) visit(rule.selectorText.trim(), rule.style)
    // Grouping rules (CSSLayerBlockRule / CSSMediaRule / …) expose nested rules.
    if (rule.cssRules && rule.cssRules.length) {
      try {
        walkRules(rule.cssRules, visit)
      } catch {
        // ignore inaccessible nested rules
      }
    }
  }
}

export function readRegistry(theme: Theme): RegistrySnapshot {
  const tokens = new Map<string, TokenDef>()
  const order: string[] = []

  const applyStyle = (style: CSSStyleDeclaration) => {
    for (const name of Array.from(style)) {
      if (!name.startsWith('--color')) continue
      const authored = style.getPropertyValue(name).trim()

      if (!authored) continue
      if (!tokens.has(name)) order.push(name)
      tokens.set(name, {
        name,
        authored,
        kind: classifyKind(authored),
        refs: extractRefs(authored),
        group: classifyGroup(name),
      })
    }
  }

  const visit: Visit = (selector, style) => {
    const isDark = DARK_SELECTORS.has(selector)
    const isLight = selector === 'html.light'

    // Dark = raw `:root` scale + `html` semantics. Light = that base overlaid
    // with `html.light` (applied later in document order → last-write-wins).
    if (theme === 'dark' && isDark) applyStyle(style)
    if (theme === 'light' && (isDark || isLight)) applyStyle(style)
  }

  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList | null

    try {
      rules = sheet.cssRules
    } catch {
      rules = null // cross-origin / inaccessible sheet
    }
    if (!rules) continue
    walkRules(rules, visit)
  }

  return { theme, tokens, order }
}

// Currently-applied value (reflects inline overrides + var() resolution).
export function resolveComputed(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

export function currentTheme(): Theme {
  return document.documentElement.classList.contains('light') ? 'light' : 'dark'
}
