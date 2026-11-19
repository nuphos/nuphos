import { BrowserWindow } from 'electron'

import type { Helper } from './browser-video.ts'

/** The hidden window that encodes a recorded tab's video (browser-video.ts); it never comes on screen. */
export async function openVideoWindow(): Promise<Helper> {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // It encodes in real time while nobody looks at it.
      backgroundThrottling: false,
    },
  })

  await window.loadURL('about:blank')

  return {
    evaluate: (script) => window.webContents.executeJavaScript(script),
    close: () => window.destroy(),
  }
}
