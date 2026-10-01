import { createContext, useContext } from 'react'

export type ThemePreference = 'light' | 'dark' | 'system'

export type ThemeContextValue = {
  preference: ThemePreference
  resolved: 'light' | 'dark'
  setPreference: (next: ThemePreference) => void
}

// The provider lives in `ThemeProvider.tsx` — a module that exports a component
// alongside hooks/constants breaks Fast Refresh.
export const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)

  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')

  return ctx
}
