import { useCallback, useEffect, useState } from 'react'

import { useTheme } from '../../hooks/useTheme'

import { hexToTriple, tripleToHex } from './colorMath'
import { clearAll, clearOverride, loadOverrides, setOverride } from './overrides'
import { readRegistry, resolveComputed } from './registry'

import type { OverrideSet, PaletteExport, RegistrySnapshot, Theme } from './types'

// Owns the registry snapshot + override set for the active theme, keeps them in
// sync with theme flips and Vite HMR, and exposes edit/reset/export actions.
export function usePaletteState() {
  const { resolved } = useTheme()
  const theme = resolved as Theme

  const [registry, setRegistry] = useState<RegistrySnapshot>(() => readRegistry(theme))
  const [overrides, setOverrides] = useState<OverrideSet>(() => loadOverrides()[theme])
  // Bumped after every edit so swatch rows (which read live CSS vars) re-render.
  const [rev, setRev] = useState(0)

  // Theme flip: re-derive the catalog + overrides during render (the sanctioned
  // "adjust state from a changed input" pattern). Re-applying the theme's inline
  // overrides is owned by the always-mounted DevPalette.
  const [prevTheme, setPrevTheme] = useState(theme)

  if (prevTheme !== theme) {
    setPrevTheme(theme)
    setRegistry(readRegistry(theme))
    setOverrides(loadOverrides()[theme])
    setRev((r) => r + 1)
  }

  const refreshRegistry = useCallback(() => {
    setRegistry(readRegistry(theme))
    setRev((r) => r + 1)
  }, [theme])

  // Re-read the catalog after Vite swaps the stylesheet in dev.
  useEffect(() => {
    const hot = import.meta.hot

    if (!hot) return
    const handler = () => refreshRegistry()

    hot.on('vite:afterUpdate', handler)

    return () => hot.off('vite:afterUpdate', handler)
  }, [refreshRegistry])

  const setTokenColor = useCallback(
    (name: string, hex: string) => {
      const triple = hexToTriple(hex)

      if (!triple) return
      setOverrides(setOverride(theme, name, triple)[theme])
      setRev((r) => r + 1)
    },
    [theme],
  )

  const setTokenTriple = useCallback(
    (name: string, triple: string) => {
      if (!/^\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*$/.test(triple)) return
      const clean = triple
        .split(',')
        .map((n) => String(Math.max(0, Math.min(255, parseInt(n, 10)))))
        .join(', ')

      setOverrides(setOverride(theme, name, clean)[theme])
      setRev((r) => r + 1)
    },
    [theme],
  )

  const resetToken = useCallback(
    (name: string) => {
      setOverrides(clearOverride(theme, name)[theme])
      setRev((r) => r + 1)
    },
    [theme],
  )

  const resetAll = useCallback(() => {
    setOverrides(clearAll(theme)[theme])
    setRev((r) => r + 1)
  }, [theme])

  const exportJson = useCallback((): PaletteExport => {
    const tokens = registry.order.map((name) => {
      const def = registry.tokens.get(name)!
      const value = resolveComputed(name)
      const hex = def.kind === 'triple' || def.kind === 'ref' ? tripleToHex(value) : null

      return {
        name,
        authored: def.authored,
        value,
        hex,
        overridden: name in overrides,
        kind: def.kind,
      }
    })

    return { theme, generatedAt: new Date().toISOString(), tokens }
  }, [registry, overrides, theme])

  return {
    theme,
    registry,
    overrides,
    rev,
    refreshRegistry,
    setTokenColor,
    setTokenTriple,
    resetToken,
    resetAll,
    exportJson,
  }
}

export type PaletteState = ReturnType<typeof usePaletteState>
