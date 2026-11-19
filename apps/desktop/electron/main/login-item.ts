// Opening Nuphos when the user signs in to the OS, so a computer's local
// runtime comes back after a restart without anyone opening the app by hand.
// It opens as it would by hand, with its windows: the renderer is what reads
// the stored sign-in, and the local runtime follows that sign-in.
//
// Electron registers the login item on macOS and Windows. The login item
// itself is the setting: it lives in the OS, so turning it off in System
// Settings or Task Manager is read back here instead of drifting from a copy.
//
// Runtime imports stay free of Electron so this loads under plain `node --test`.

export type LoginItemState = { supported: boolean; openAtLogin: boolean }

export type LoginItemApp = {
  isPackaged: boolean
  getLoginItemSettings(): { openAtLogin: boolean }
  setLoginItemSettings(settings: { openAtLogin: boolean }): void
}

/** An unpackaged build would register the bare Electron binary, so only releases offer it. */
export function loginItemSupported(app: LoginItemApp, platform: NodeJS.Platform): boolean {
  return app.isPackaged && (platform === 'darwin' || platform === 'win32')
}

export function readLoginItem(app: LoginItemApp, platform: NodeJS.Platform): LoginItemState {
  if (!loginItemSupported(app, platform)) return { supported: false, openAtLogin: false }

  return { supported: true, openAtLogin: app.getLoginItemSettings().openAtLogin }
}

export function writeLoginItem(
  app: LoginItemApp,
  platform: NodeJS.Platform,
  openAtLogin: unknown,
): LoginItemState {
  if (typeof openAtLogin !== 'boolean') throw new Error('openAtLogin must be true or false')
  if (!loginItemSupported(app, platform))
    throw new Error('Opening Nuphos at login is not available on this computer.')
  app.setLoginItemSettings({ openAtLogin })

  return readLoginItem(app, platform)
}
