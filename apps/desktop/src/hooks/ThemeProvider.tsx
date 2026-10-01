import { useCallback, useEffect, useMemo, useState } from 'react'

import { api } from '../api'

import { ThemeContext } from './useTheme'

import type { ThemePreference } from './useTheme'
import type { ReactNode } from 'react'

const STORAGE_KEY = 'atlas.theme'

function readStored(): ThemePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY)

    if (value === 'light' || value === 'dark' || value === 'system') return value
  } catch {
    // ignore (e.g. private mode)
  }

  return 'system'
}

function systemPrefersLight(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: light)').matches
  )
}

function applyToDocument(resolved: 'light' | 'dark') {
  const html = document.documentElement

  if (resolved === 'light') html.classList.add('light')
  else html.classList.remove('light')
}

/**
 * Owns the single source of truth for the app theme and keeps the `html.light`
 * class in sync. Mounted once at the root so the `prefers-color-scheme`
 * listener stays alive for the whole session — that's what makes a "System"
 * preference follow live macOS appearance changes (previously the listener
 * only existed while Settings or a terminal view happened to be mounted).
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStored)
  const [systemIsLight, setSystemIsLight] = useState<boolean>(systemPrefersLight)

  const resolved: 'light' | 'dark' =
    preference === 'system' ? (systemIsLight ? 'light' : 'dark') : preference

  useEffect(() => {
    applyToDocument(resolved)
  }, [resolved])

  useEffect(() => {
    // Optional chain through `.catch` too: if the preload bridge is missing
    // the appSetNativeTheme call returns undefined, and `.catch` would throw.
    void api.appSetNativeTheme?.(preference)?.catch(() => undefined)
  }, [preference])

  useEffect(() => {
    if (preference !== 'system' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const handler = () => setSystemIsLight(mq.matches)

    mq.addEventListener('change', handler)
    // Re-sync now in case the OS appearance changed between the initial read
    // and this subscription (or while the preference was not 'system').
    handler()

    return () => mq.removeEventListener('change', handler)
  }, [preference])

  useEffect(() => {
    // Authoritative signal for Electron: the main process forwards
    // `nativeTheme` updates here. Renderer `matchMedia('prefers-color-scheme')`
    // change events don't fire reliably in Electron, so this is what actually
    // makes "System" follow live macOS light/dark switches.
    if (preference !== 'system') return

    return api.onNativeThemeUpdated?.(({ shouldUseDarkColors }) => {
      setSystemIsLight(!shouldUseDarkColors)
    })
  }, [preference])

  const setPreference = useCallback((next: ThemePreference) => {
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // ignore
    }
    setPreferenceState(next)
  }, [])

  const value = useMemo(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
