// A conversation's dock tab watched live from the iPhone (browser-view.ts); the
// dock's listing and the phone's changes to it are in dock-mirror.ts.
import { BrowserWindow, ipcMain, webContents } from 'electron'

import type { WatchTab } from './browser-view.ts'

/** After Stop on the Mac, that tab turns phones away this long, so the viewer's retries end. */
const STOPPED_MS = 30_000

/** Tabs a phone watches now, each with what ends its stream; and when the Mac last stopped one. */
const viewing = new Map<string, () => void>()
const stoppedAt = new Map<string, number>()

/** The Mac's Stop on a watched dock tab: ends the phone's stream and turns it away for a while. */
export function stopDockTabWatch(tab: string): void {
  stoppedAt.set(tab, Date.now())
  viewing.get(tab)?.()
}

ipcMain.on('dock:stopWatch', (_event, tab: unknown) => {
  if (typeof tab === 'string') stopDockTabWatch(tab)
})

/** How long a watched tab may take to mount and attach its page in the renderer. */
const WATCH_TIMEOUT_MS = 20_000

/**
 * A phone starts watching a dock tab (`browser-view.ts`): the window holding it
 * mounts its page and keeps it painting at the phone's size, invisibly, without
 * changing what the Mac shows. Null when no window has that tab.
 */
export const watchDockTab: WatchTab = async (session, tab, width, height, end) => {
  if (Date.now() - (stoppedAt.get(tab) ?? 0) < STOPPED_MS)
    return { refused: 'Viewing was stopped on the Mac. Try again in a moment.' }
  if (viewing.has(tab)) return { refused: 'This tab is already open on another phone.' }
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    const call = `window.nuphosWatchDockTab?.(${[session, tab, width, height].map((v) => JSON.stringify(v)).join(', ')}) ?? null`
    const unwatch = () => {
      if (!window.isDestroyed())
        window.webContents
          .executeJavaScript(`window.nuphosUnwatchDockTab?.(${JSON.stringify(tab)})`)
          .catch(() => {})
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const answer = await Promise.race([
      (window.webContents.executeJavaScript(call) as Promise<unknown>).then(
        (id) => ({ id }),
        () => ({ id: null }),
      ),
      new Promise<'late'>((resolve) => {
        timer = setTimeout(() => resolve('late'), WATCH_TIMEOUT_MS)
      }),
    ]).finally(() => clearTimeout(timer))

    // A window that answers too late, or names a page that is gone, must not keep its watch.
    if (answer === 'late') {
      unwatch()
      continue
    }
    const page = typeof answer.id === 'number' ? webContents.fromId(answer.id) : undefined

    if (page) {
      viewing.set(tab, end)

      return {
        page,
        stop: () => {
          viewing.delete(tab)
          unwatch()
        },
      }
    }
    if (typeof answer.id === 'number') unwatch()
  }

  return null
}
