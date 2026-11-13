// The automatic restart into a downloaded update (auto-update.ts) as the app
// wires it: the preference on this computer, and a check once a minute.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { app, powerMonitor } from 'electron'

import {
  AUTO_INSTALL_CHECK_MS,
  DEFAULT_AUTO_INSTALL,
  idleThreshold,
  parseAutoInstall,
  shouldAutoInstall,
} from './auto-update.ts'
import { taskActivity } from './local-runtime/sleep-prevention-electron.ts'

import type { AutoInstallPreferences } from './auto-update.ts'

const preferencesFile = () => join(app.getPath('userData'), 'auto-update.json')

let preferences: AutoInstallPreferences | null = null
let timer: ReturnType<typeof setInterval> | null = null

export function readAutoInstall(): AutoInstallPreferences {
  if (!preferences) {
    try {
      preferences = parseAutoInstall(JSON.parse(readFileSync(preferencesFile(), 'utf8')))
    } catch {
      preferences = { ...DEFAULT_AUTO_INSTALL }
    }
  }

  return preferences
}

export function writeAutoInstall(value: unknown): AutoInstallPreferences {
  const next = parseAutoInstall(value)

  writeFileSync(preferencesFile(), JSON.stringify(next))
  preferences = next

  return next
}

/** `install` is the restart the Restart button does, so it restores the windows and
 *  reports a failed install the same way. */
export function startAutoInstall(update: {
  ready: () => { failedBefore: boolean } | null
  install: () => void
}): void {
  if (timer) return
  const idleSeconds = idleThreshold(process.env)

  timer = setInterval(() => {
    const ready = update.ready()
    const install = shouldAutoInstall(
      {
        enabled: readAutoInstall().enabled,
        ready: ready !== null,
        failedBefore: ready?.failedBefore ?? false,
        busy: taskActivity.busy(),
        idleSeconds: powerMonitor.getSystemIdleTime(),
      },
      idleSeconds,
    )

    if (install) update.install()
  }, AUTO_INSTALL_CHECK_MS)
  timer.unref()
}
