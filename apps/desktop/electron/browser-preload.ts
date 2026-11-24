// Preload for web pages in the Dock browser session (`persist:browser`), registered by
// `initWebviewGuard`. It exposes nothing to the page: it fills in Chrome's own globals and
// tells the main process when the page waits for a passkey.
import { contextBridge, ipcRenderer } from 'electron'

import { addChromeObject } from './browser-preload/chrome-object'
import { watchPasskeyRequests } from './browser-preload/passkey-requests'

contextBridge.executeInMainWorld({ func: addChromeObject })

// Windows shows its own passkey window; elsewhere a request waits with nothing on screen.
if (process.platform !== 'win32') {
  const cancel = contextBridge.executeInMainWorld({
    func: watchPasskeyRequests,
    args: [
      (id: number, waiting: boolean) => {
        ipcRenderer.send('browser-passkey:request', id, waiting)
      },
    ],
  }) as (id: number) => void

  ipcRenderer.on('browser-passkey:cancel', (_event, id: number) => {
    cancel(id)
  })
}
