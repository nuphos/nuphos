import fs from 'node:fs'
import path from 'node:path'

/** What a packaged build's data was named before it set its own path: `name` in package.json. */
export const LEGACY_USER_DATA_NAME = 'k8s-gui'

/**
 * Chromium's markers for a directory it has written a profile into. Any one of them means
 * an install has been running with its sign-in and settings in there.
 */
const PROFILE_ENTRIES = ['Local Storage', 'IndexedDB', 'Preferences']

export type UserDataChoice = {
  /** Where this build keeps its profile and its local runtime. */
  dir: string
  /** A second directory that holds a profile, left exactly where it is. */
  leftAlone: string | null
}

/**
 * Whether Chromium has stored a profile in `dir`. Looks at its contents, never at the
 * directory itself: reading `app.getPath('userData')` creates an empty directory, and an
 * empty one is not an install.
 */
export function hasProfile(dir: string): boolean {
  return PROFILE_ENTRIES.some((entry) => fs.existsSync(path.join(dir, entry)))
}

/**
 * Where a packaged build keeps its profile and its local runtime. An install that already
 * has a profile in the legacy directory keeps using it: its sign-in, its settings and its
 * agent homes are in there, and a live Chromium profile has no safe moment to be moved.
 * A new install, or one whose legacy directory holds no profile, gets `<appData>/<appName>`.
 * A dev build does not come here at all; it keeps its own per-instance directory.
 *
 * This picks; it does not move, rename or delete anything. A directory it does not pick is
 * reported so the caller can say so, rather than tidying it away.
 */
export function resolveUserData(appData: string, appName: string): UserDataChoice {
  const legacy = path.join(appData, LEGACY_USER_DATA_NAME)
  const named = path.join(appData, appName)

  // The legacy profile wins even when `<appData>/<appName>` holds one too: an install can
  // have both, from releases that wrote to each name in turn, and the legacy directory is
  // the one its data was last in. Nothing is merged, and neither is touched.
  if (hasProfile(legacy)) return { dir: legacy, leftAlone: hasProfile(named) ? named : null }

  return { dir: named, leftAlone: null }
}
