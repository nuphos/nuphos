import { BrowserWindow, session } from 'electron'

import { HELPER_URL } from './browser-video.ts'

import type { Helper } from './browser-video.ts'

/** The hidden window that encodes a recorded tab's video (browser-video.ts); it never comes on screen. */
export async function openVideoWindow(): Promise<Helper> {
  // A session of its own answers the helper's https page itself, and nothing else uses it.
  const own = session.fromPartition('nuphos-video')

  if (!own.protocol.isProtocolHandled('https'))
    own.protocol.handle(
      'https',
      () => new Response('', { headers: { 'content-type': 'text/html' } }),
    )
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    webPreferences: {
      session: own,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // It encodes in real time while nobody looks at it.
      backgroundThrottling: false,
    },
  })

  await window.loadURL(HELPER_URL)

  return {
    evaluate: (script) => window.webContents.executeJavaScript(script),
    close: () => window.destroy(),
  }
}
