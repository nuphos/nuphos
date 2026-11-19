import { readAutoInstall, writeAutoInstall } from './auto-update-electron'
import { checkForUpdates, getUpdaterState, installUpdate } from './updater'

/** The app's own updates: status, a check, the restart, and installing by itself when idle. */
export const updaterChannels = {
  'updater:getState': () => getUpdaterState(),
  'updater:check': () => checkForUpdates(),
  'updater:install': () => installUpdate(),
  'updater:getAutoInstall': () => readAutoInstall(),
  'updater:setAutoInstall': (_e: unknown, value: unknown) => writeAutoInstall(value),
}
