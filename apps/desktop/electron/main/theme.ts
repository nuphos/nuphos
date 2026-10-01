import fsSync from 'node:fs'
import path from 'node:path'

import { app } from 'electron'

export type ThemeSource = 'system' | 'light' | 'dark'

export function readPersistedThemeSource(): ThemeSource {
  // Best-effort: read theme preference from a tiny config file under userData.
  // Falls back to 'system' if anything goes wrong.
  try {
    const file = path.join(app.getPath('userData'), 'theme.json')
    const raw = fsSync.readFileSync(file, 'utf8')
    const parsed = JSON.parse(raw) as { theme?: unknown }

    if (parsed.theme === 'light' || parsed.theme === 'dark' || parsed.theme === 'system') {
      return parsed.theme
    }
  } catch {
    // ignore
  }

  return 'system'
}

export function writePersistedThemeSource(value: ThemeSource) {
  try {
    const file = path.join(app.getPath('userData'), 'theme.json')

    fsSync.writeFileSync(file, JSON.stringify({ theme: value }), 'utf8')
  } catch {
    // ignore
  }
}
