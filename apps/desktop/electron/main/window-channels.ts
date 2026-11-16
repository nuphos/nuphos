import { BrowserWindow, ipcMain } from 'electron'

import { isAppWebUrl } from '../web-base-url'

import { initWindowSessionChannels } from './window-session'
import { createWindow } from './windows'

/** The page a window was opened to show, until its renderer takes it. */
const windowPages = new WeakMap<BrowserWindow, string>()

/** IPC for the app's windows: their saved sessions, and windows opened for one page. */
export function initWindowChannels() {
  initWindowSessionChannels()
  ipcMain.on('window:open-page', (_event, url: unknown) => {
    if (typeof url === 'string' && isAppWebUrl(url)) windowPages.set(createWindow(null), url)
  })
  ipcMain.handle('window:take-page', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const url = win ? windowPages.get(win) : undefined

    if (win) windowPages.delete(win)

    return url ?? null
  })
}
