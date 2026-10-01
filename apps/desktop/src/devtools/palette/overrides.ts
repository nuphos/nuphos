// Theme-aware persistence + live application of token overrides. Because the
// whole app reads colors as `rgb(var(--color-x))`, setting an inline custom
// property on <html> recolors everything instantly, dependents included.

import type { OverrideSet, OverrideStore, Theme } from './types'

const KEY = 'nuphos.devPalette.overrides'

// Names we've written to <html> inline, so unapply removes exactly ours and a
// dark override never leaks into light on theme switch.
const applied = new Set<string>()

function readRaw(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

function writeRaw(value: string): void {
  try {
    localStorage.setItem(KEY, value)
  } catch {
    // ignore (e.g. private mode)
  }
}

export function loadOverrides(): OverrideStore {
  const raw = readRaw()

  if (!raw) return { dark: {}, light: {} }
  try {
    const parsed = JSON.parse(raw) as Partial<OverrideStore>

    return { dark: parsed.dark ?? {}, light: parsed.light ?? {} }
  } catch {
    return { dark: {}, light: {} }
  }
}

export function saveOverrides(store: OverrideStore): void {
  writeRaw(JSON.stringify(store))
}

const root = () => document.documentElement

export function applyOverrides(theme: Theme): void {
  const set: OverrideSet = loadOverrides()[theme]

  for (const [name, triple] of Object.entries(set)) {
    root().style.setProperty(name, triple)
    applied.add(name)
  }
}

export function unapplyAll(): void {
  for (const name of applied) root().style.removeProperty(name)
  applied.clear()
}

export function reapplyForTheme(theme: Theme): void {
  unapplyAll()
  applyOverrides(theme)
}

export function setOverride(theme: Theme, name: string, triple: string): OverrideStore {
  const store = loadOverrides()

  store[theme] = { ...store[theme], [name]: triple }
  saveOverrides(store)
  root().style.setProperty(name, triple)
  applied.add(name)

  return store
}

export function clearOverride(theme: Theme, name: string): OverrideStore {
  const store = loadOverrides()
  const next: OverrideSet = { ...store[theme] }

  delete next[name]
  store[theme] = next
  saveOverrides(store)
  root().style.removeProperty(name)
  applied.delete(name)

  return store
}

export function clearAll(theme: Theme): OverrideStore {
  const store = loadOverrides()

  for (const name of Object.keys(store[theme])) {
    root().style.removeProperty(name)
    applied.delete(name)
  }
  store[theme] = {}
  saveOverrides(store)

  return store
}

// Apply saved overrides for the active theme once on app start.
export function bootPalette(): void {
  const theme: Theme = root().classList.contains('light') ? 'light' : 'dark'

  applyOverrides(theme)
}
