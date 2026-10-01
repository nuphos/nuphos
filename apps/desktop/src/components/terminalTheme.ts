import type { ITheme } from '@xterm/xterm'

// xterm.js doesn't read CSS variables, so we keep two palettes that mirror the
// app's dark / light tokens (see html.light in index.css). Both meet AA against
// their own background.
const DARK_THEME: ITheme = {
  background: '#0f0e11',
  foreground: '#eceaf0',
  cursor: '#eceaf0',
  cursorAccent: '#0f0e11',
  selectionBackground: '#5f5a68',
  black: '#151318',
  red: '#f87171',
  green: '#34d399',
  yellow: '#fbbf24',
  blue: '#93c5fd',
  magenta: '#c084fc',
  cyan: '#67e8f9',
  white: '#e5e7eb',
  brightBlack: '#6b6674',
  brightRed: '#fca5a5',
  brightGreen: '#6ee7b7',
  brightYellow: '#fde68a',
  brightBlue: '#bfdbfe',
  brightMagenta: '#ddd6fe',
  brightCyan: '#a5f3fc',
  brightWhite: '#ffffff',
}

const LIGHT_THEME: ITheme = {
  background: '#ffffff',
  foreground: '#1a1a1f',
  cursor: '#1a1a1f',
  cursorAccent: '#ffffff',
  selectionBackground: '#c7d2fe',
  black: '#1a1a1f',
  red: '#b91c1c',
  green: '#15803d',
  yellow: '#a16207',
  blue: '#1d4ed8',
  magenta: '#6d28d9',
  cyan: '#0e7490',
  white: '#4c4854',
  brightBlack: '#65616b',
  brightRed: '#dc2626',
  brightGreen: '#16a34a',
  brightYellow: '#ca8a04',
  brightBlue: '#2563eb',
  brightMagenta: '#7c3aed',
  brightCyan: '#0891b2',
  brightWhite: '#1a1a1f',
}

export function xtermThemeFor(resolved: 'light' | 'dark'): ITheme {
  return resolved === 'light' ? LIGHT_THEME : DARK_THEME
}
