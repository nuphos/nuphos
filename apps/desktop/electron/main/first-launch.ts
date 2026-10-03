import fs from 'node:fs'
import path from 'node:path'

// Check before Electron creates Chromium state. Existing installations must not
// see the intro merely because this feature was added in an update.
export function prepareFirstLaunch(userData: string): () => boolean {
  try {
    const existing = fs.existsSync(userData) && fs.readdirSync(userData).length > 0

    return () => {
      try {
        fs.mkdirSync(userData, { recursive: true })
        fs.writeFileSync(path.join(userData, 'first-launch.json'), '{}', { flag: 'wx' })

        return !existing
      } catch {
        return false
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      console.warn('[first-launch]', error)
    }

    // Never block startup or replay on every launch if persistence fails.
    return () => false
  }
}
