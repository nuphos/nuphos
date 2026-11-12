import { ipcMain, session } from 'electron'

import { browserExtensionChannels } from './browser-extensions/channels.ts'
import { initBrowserExtensions } from './browser-extensions/host.ts'
import { logError } from './browser-extensions/log.ts'
import { grantsMicrophone } from './media-permission.ts'
import { initWebviewGuard } from './webview-guard.ts'

/**
 * The in-app browser's sessions: the guard on every guest, then Chrome
 * extensions in the user's session. Runs before any window exists, so every
 * guest gets the guard and every Dock tab registers with the extension host.
 */
export function initBrowserSessions() {
  initWebviewGuard()
  // The app's own session: the composer's voice input may use the microphone. Every other
  // permission is still granted, as Electron does when a session has no handler.
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
    if (permission !== 'media') {
      callback(true)

      return
    }
    const { mediaTypes } = details as { mediaTypes?: string[] }

    callback(
      grantsMicrophone(
        details.requestingUrl,
        mediaTypes,
        process.env.VITE_DEV_SERVER_URL || 'app://./index.html',
      ),
    )
  })
  for (const [name, handler] of Object.entries(browserExtensionChannels))
    ipcMain.handle(name, handler as never)
  initBrowserExtensions().catch((error: unknown) => logError('failed to start:', error))
}
