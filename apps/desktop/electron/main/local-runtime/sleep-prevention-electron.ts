import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { app, powerMonitor, powerSaveBlocker } from 'electron'

import { authSession } from '../../auth-session.ts'

import {
  DEFAULT_SLEEP_PREFERENCES,
  parseSleepPreferences,
  RuntimeTaskActivity,
  SleepPrevention,
} from './sleep-prevention.ts'

let changed = () => {
  /* Replaced when the runtime initializes. */
}

export const taskActivity = new RuntimeTaskActivity(() => changed())
const sleepPrevention = new SleepPrevention({
  supported: process.platform === 'darwin',
  onBattery: () => powerMonitor.isOnBatteryPower(),
  signedIn: () => Boolean(authSession.current()),
  busy: () => taskActivity.busy(),
  start: () => powerSaveBlocker.start('prevent-app-suspension'),
  stop: (id) => powerSaveBlocker.stop(id),
})
const sleepFile = () => path.join(app.getPath('userData'), 'sleep-prevention.json')

export const sleepState = () => sleepPrevention.state()
export const stopSleepPrevention = () => sleepPrevention.dispose()

export function setSleepPreferences(value: unknown) {
  const preferences = parseSleepPreferences(value)

  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(sleepFile(), JSON.stringify(preferences), { mode: 0o600 })
  sleepPrevention.configure(preferences)
  changed()

  return sleepState()
}

export function initSleepPrevention(onChange: () => void): void {
  changed = onChange
  try {
    sleepPrevention.configure(parseSleepPreferences(JSON.parse(readFileSync(sleepFile(), 'utf8'))))
  } catch {
    sleepPrevention.configure(DEFAULT_SLEEP_PREFERENCES)
  }
  powerMonitor.on('on-ac', changed)
  powerMonitor.on('on-battery', changed)
  authSession.subscribe(() => changed())
}
