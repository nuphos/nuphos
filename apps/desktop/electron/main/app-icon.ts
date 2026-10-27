import fsSync from 'node:fs'
import path from 'node:path'

import { app } from 'electron'

import { isDev } from './env'

// B2 is the bundled icon; A is the original mark. All but A come from
// scripts/render-app-icons.mjs.
export const APP_ICONS = ['A', ...'BCDEF'.split('').flatMap((c) => [`${c}1`, `${c}2`, `${c}3`])]

const file = () => path.join(app.getPath('userData'), 'app-icon.json')

export function readAppIcon(): string {
  try {
    const { icon } = JSON.parse(fsSync.readFileSync(file(), 'utf8')) as { icon?: unknown }

    if (typeof icon === 'string' && APP_ICONS.includes(icon)) return icon
  } catch {
    // No choice saved yet.
  }

  return 'B2'
}

/** Shows the icon on the running Dock tile. Finder keeps the bundled icon. */
export function applyAppIcon(icon: string) {
  if (process.platform !== 'darwin') return
  // electron-builder packs public/ into dist/; dev serves it from public/.
  app.dock?.setIcon(
    path.join(__dirname, '..', isDev ? 'public' : 'dist', 'app-icons', `${icon}.png`),
  )
}

export function setAppIcon(icon: string) {
  if (!APP_ICONS.includes(icon)) throw new Error(`Invalid app icon: ${icon}`)
  fsSync.writeFileSync(file(), JSON.stringify({ icon }), 'utf8')
  applyAppIcon(icon)
}
