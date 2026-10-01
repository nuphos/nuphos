// Shared types for the dev-only color palette tuner. Everything under
// src/devtools/palette/ is gated behind `import.meta.env.DEV` and tree-shaken
// out of production builds.

export type Theme = 'dark' | 'light'

// How a token's authored value reads in index.css:
//   triple → "25, 24, 27"           (editable as an RGB color)
//   ref    → "var(--color-zGray-900)" (a dependency edge; resolves to a color)
//   rgba   → "rgba(255,255,255,0.05)" (alpha token, e.g. sidebar overlays — read-only)
//   other  → anything else (durations, easings — not shown by the color tool)
export type TokenKind = 'triple' | 'ref' | 'rgba' | 'other'

export type TokenDef = {
  name: string // "--color-zGray-900"
  authored: string // raw value straight from the CSS rule (preserves var(...))
  kind: TokenKind
  refs: string[] // token names referenced via var(...) — graph edges
  group: 'raw' | 'semantic' // palette scale vs semantic/theme token
}

export type RegistrySnapshot = {
  theme: Theme
  tokens: Map<string, TokenDef>
  order: string[] // authored order, for stable listing
}

// A map of token name → "r, g, b" triple.
export type OverrideSet = Record<string, string>

export type OverrideStore = {
  dark: OverrideSet
  light: OverrideSet
}

export type PaletteTokenExport = {
  name: string
  authored: string
  value: string // resolved computed value (reflects overrides + var resolution)
  hex: string | null
  overridden: boolean
  kind: TokenKind
}

export type PaletteExport = {
  theme: Theme
  generatedAt: string
  tokens: PaletteTokenExport[]
}
