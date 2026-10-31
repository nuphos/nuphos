// A conversation's dock tabs as the iPhone sees them: listed from each window's
// workspace store, brought forward on this Mac, or watched live (browser-view.ts).
import { BrowserWindow, webContents } from 'electron'

import { raiseWindow } from '../../window-raise.ts'

import { failed } from './cua-host.ts'

import type { BrowserCall } from './browser-stream.ts'
import type { WatchTab } from './browser-view.ts'
import type { CuaToolResult } from './cua-host.ts'

const text = (value: unknown): CuaToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value ?? null, null, 2) }],
})

/** How long a window's renderer may take to list its docks. */
const DOCK_TIMEOUT_MS = 5_000

type DockTab = { id: string; url: string; title: string }

/**
 * A window's dock tabs for the conversation, from its workspace store: tabs the
 * user opened and tabs restored after a restart, not only those `open` made.
 * Null when the window does not answer in time (no workspace loaded yet).
 */
async function windowDockTabs(window: BrowserWindow, session: string): Promise<DockTab[] | null> {
  const read = window.webContents.executeJavaScript(
    `window.nuphosDockBrowserTabs?.(${JSON.stringify(session)}) ?? null`,
  ) as Promise<DockTab[] | null>
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), DOCK_TIMEOUT_MS)
  })

  try {
    return await Promise.race([read.catch(() => null), late])
  } finally {
    clearTimeout(timer)
  }
}

/** The conversation's dock tabs across this Mac's windows, each with the window that holds it. */
export async function dockTabs(session: string) {
  const found = new Map<string, { tab: DockTab; window: BrowserWindow }>()

  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    for (const tab of (await windowDockTabs(window, session)) ?? [])
      if (!found.has(tab.id)) found.set(tab.id, { tab, window })
  }

  return found
}

/** How long a watched tab may take to mount and attach its page in the renderer. */
const WATCH_TIMEOUT_MS = 20_000

/**
 * A phone starts watching a dock tab (`browser-view.ts`): the window holding it
 * mounts its page and keeps it painting at the phone's size, invisibly, without
 * changing what the Mac shows. Null when no window has that tab.
 */
export const watchDockTab: WatchTab = async (session, tab, width, height) => {
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

    if (page) return { page, stop: unwatch }
    if (typeof answer.id === 'number') unwatch()
  }

  return null
}

/** Another screen (the iPhone) asks to see a dock tab on this Mac: its window, its chat, its tab. */
export async function focusDockTab(call: BrowserCall): Promise<CuaToolResult> {
  const found = call.dockTab ? (await dockTabs(call.session)).get(call.dockTab) : undefined

  if (!found) return failed(`Tab ${String(call.dockTab)} is not in this conversation's dock.`)
  if (!raiseWindow(found.window)) return failed('No Nuphos window is showing this tab.')
  found.window.webContents.send('agent:focus-session', {
    sessionId: call.session,
    teamId: call.team,
    dockTab: found.tab.id,
  })

  return text(found.tab)
}
