import { ipcMain } from 'electron'

import { browserExtensionChannels } from './browser-extensions/channels.ts'
import { initBrowserExtensions } from './browser-extensions/host.ts'
import { initWebviewGuard } from './webview-guard.ts'

/**
 * The in-app browser's sessions: the guard on every guest, then Chrome
 * extensions in the user's session. Runs before any window exists, so every
 * guest gets the guard and every Dock tab registers with the extension host.
 */
export function initBrowserSessions() {
  initWebviewGuard()
  for (const [name, handler] of Object.entries(browserExtensionChannels))
    ipcMain.handle(name, handler as never)
  initBrowserExtensions().catch((error: unknown) => {
    console.error('[browser-extensions] failed to start:', error)
  })
}
