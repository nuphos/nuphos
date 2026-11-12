import { createRequire } from 'node:module'
import path from 'node:path'

import { app, BrowserWindow, ipcMain } from 'electron'

type NativeGestures = {
  start(callback: (phase: 'begin' | 'end') => void): void
  haptic(): void
}

let initialized = false

/** AppKit phases are queued into Node; only this app's local events are observed. */
export function initSidebarGestures() {
  if (initialized || process.platform !== 'darwin') return
  initialized = true
  try {
    const file = app.isPackaged
      ? path.join(process.resourcesPath, 'native/sidebar-gestures.node')
      : path.join(app.getAppPath(), 'build/native/sidebar-gestures.node')
    const native = createRequire(import.meta.url)(file) as NativeGestures

    native.start((phase) => {
      const win = BrowserWindow.getFocusedWindow()

      if (win && !win.isDestroyed()) win.webContents.send('sidebar:gesture-phase', phase)
    })
    let lastHaptic = 0

    ipcMain.on('sidebar:haptic', (event) => {
      const win = BrowserWindow.getFocusedWindow()
      const now = performance.now()

      if (win?.webContents !== event.sender || now - lastHaptic < 80) return
      lastHaptic = now
      native.haptic()
    })
    console.log('[sidebar-gestures] macOS release and firm midpoint feedback ready')
  } catch (error) {
    // Non-native hosts still support wheel/touch paging with a short quiet timeout.
    console.warn('[sidebar-gestures] native gestures unavailable:', error)
  }
}
