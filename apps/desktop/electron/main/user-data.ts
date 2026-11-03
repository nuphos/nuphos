import fs from 'node:fs'
import path from 'node:path'

// Packaged builds never set userData, so Electron named it after package.json's
// `name`. Installs from then keep their data there; nothing moves it.
export const LEGACY_USER_DATA_NAME = 'k8s-gui'

/**
 * Picks the userData directory for a packaged build: the legacy one while it
 * holds a profile, otherwise <appData>/<appName>. Never moves, renames or
 * deletes either directory.
 */
export function resolveUserData(appData: string, appName: string): string {
  const legacy = path.join(appData, LEGACY_USER_DATA_NAME)

  return hasProfile(legacy) ? legacy : path.join(appData, appName)
}

/**
 * Whether Chromium has stored a profile in dir. Checks contents rather than the
 * directory itself, because reading app.getPath('userData') creates it.
 */
function hasProfile(dir: string): boolean {
  return ['Local Storage', 'IndexedDB', 'Preferences'].some((entry) =>
    fs.existsSync(path.join(dir, entry)),
  )
}
