import { BrowserWindow } from 'electron'

import { appDialogHtml } from './app-dialog-html.ts'

import type { AppDialogOptions } from './app-dialog-html.ts'

/** Main-owned modal without the app preload, scripts, or an approval IPC.
 * The requesting renderer cannot approve its own operation. Each invocation
 * gets its own isolated document and result, including concurrent requests.
 */
export function showAppDialog(
  parent: BrowserWindow | null,
  options: AppDialogOptions,
): Promise<boolean> {
  if (parent?.isDestroyed()) return Promise.resolve(false)

  return new Promise((resolve) => {
    const win = new BrowserWindow({
      ...(parent ? { parent, modal: true } : {}),
      title: options.title,
      width: 500,
      height: 330,
      show: false,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        javascript: false,
        devTools: false,
        partition: `dialog-${crypto.randomUUID()}`,
      },
    })
    let settled = false
    const finish = (confirmed: boolean) => {
      if (settled) return
      settled = true
      parent?.removeListener('closed', cancel)
      resolve(confirmed)
      if (!win.isDestroyed()) win.destroy()
    }
    const cancel = () => finish(false)

    parent?.once('closed', cancel)
    win.once('closed', cancel)
    win.webContents.once('render-process-gone', cancel)
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (event) => {
      event.preventDefault()
      // Only this isolated document may resolve its own prompt. Block all
      // other navigation, including redirects to attacker-provided content.
      if (event.initiator !== win.webContents.mainFrame) return
      const url = new URL(event.url)

      if (url.origin !== 'https://nuphos-dialog.invalid') return
      if (url.pathname === '/cancel') cancel()
      if (url.pathname === '/confirm' && options.confirmLabel) finish(true)
    })
    win.webContents.on('will-redirect', (event) => event.preventDefault())
    win.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'Escape') {
        event.preventDefault()
        cancel()
      }
    })
    win.once('ready-to-show', () => {
      if (!settled) win.show()
    })
    void win
      .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(appDialogHtml(options))}`)
      .catch(cancel)
  })
}
