// A conversation's dock as the iPhone mirrors it: every tab with its page, the
// one in front, and New Tab's Recent, read from each window's workspace store;
// and the phone's changes to it (show a tab here, close one, open a page).
import { BrowserWindow } from 'electron'

import { raiseWindow } from '../../window-raise.ts'

import { failed } from './cua-host.ts'

import type { BrowserCall } from './browser-stream.ts'
import type { CuaToolResult } from './cua-host.ts'

const text = (value: unknown): CuaToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value ?? null, null, 2) }],
})

/** How long a window's renderer may take to answer; one with no workspace yet never does. */
const ANSWER_TIMEOUT_MS = 5_000

type DockTabEntry = { id: string; kind: string; title: string; href: string; url?: string }
type DockMirror = {
  tabs: DockTabEntry[]
  activeTabId: string | null
  recent: { href: string; title: string; url?: string }[]
}

/** `window.<fn>(...args)` in a window's renderer, or null if it is missing or too slow. */
async function ask<T>(window: BrowserWindow, fn: string, ...args: unknown[]): Promise<T | null> {
  const call = `window.${fn}?.(${args.map((arg) => JSON.stringify(arg)).join(', ')}) ?? null`
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ANSWER_TIMEOUT_MS)
  })

  try {
    const answer = (window.webContents.executeJavaScript(call) as Promise<T | null>).catch(
      () => null,
    )

    return await Promise.race([answer, late])
  } finally {
    clearTimeout(timer)
  }
}

const windows = () => BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed())

/** Each window's view of the conversation's dock, with the window it came from. */
async function mirrors(call: BrowserCall) {
  const found: { window: BrowserWindow; mirror: DockMirror }[] = []

  for (const window of windows()) {
    const mirror = await ask<DockMirror>(window, 'nuphosDockMirror', call.session, call.team)

    if (mirror) found.push({ window, mirror })
  }

  return found
}

/** The dock across this Mac's windows: its tabs once each, the front tab and Recent from the first. */
export async function dockMirrorOf(call: BrowserCall): Promise<CuaToolResult> {
  const found = await mirrors(call)
  const tabs = new Map<string, DockTabEntry>()

  for (const { mirror } of found)
    for (const tab of mirror.tabs) if (!tabs.has(tab.id)) tabs.set(tab.id, tab)
  const first = found.find(({ mirror }) => mirror.tabs.length > 0) ?? found[0]

  return text({
    tabs: [...tabs.values()],
    activeTabId: first?.mirror.activeTabId ?? null,
    recent: found[0]?.mirror.recent ?? [],
  })
}

/** The window holding one of the conversation's dock tabs. */
async function windowWith(call: BrowserCall) {
  return (await mirrors(call)).find(({ mirror }) =>
    mirror.tabs.some((tab) => tab.id === call.dockTab),
  )?.window
}

const notInDock = (call: BrowserCall) =>
  failed(`Tab ${String(call.dockTab)} is not in this conversation's dock.`)

/** Shows a dock tab on this Mac: its window, its chat, its tab. */
export async function focusDockTab(call: BrowserCall): Promise<CuaToolResult> {
  const window = call.dockTab ? await windowWith(call) : undefined

  if (!window) return notInDock(call)
  if (!raiseWindow(window)) return failed('No Nuphos window is showing this tab.')
  window.webContents.send('agent:focus-session', {
    sessionId: call.session,
    teamId: call.team,
    dockTab: call.dockTab,
  })

  return text({ id: call.dockTab })
}

/** Closes a dock tab from the phone, as its × does on the Mac. */
export async function closeDockTab(call: BrowserCall): Promise<CuaToolResult> {
  const window = call.dockTab ? await windowWith(call) : undefined

  if (!window) return notInDock(call)
  const closed = await ask<boolean>(window, 'nuphosCloseDockTab', call.session, call.dockTab)

  return closed ? text({ closed: call.dockTab }) : notInDock(call)
}

/**
 * Opens a page in the conversation's dock from the phone: an app path from New
 * Tab or history, or a workspace page by its key. The renderer refuses another
 * team's path. Answers the new tab's id.
 */
export async function openDockTab(call: BrowserCall): Promise<CuaToolResult> {
  const target = call.href ? { href: call.href } : call.page ? { page: call.page } : null

  if (!target) return failed('href or page is required.')
  for (const window of windows()) {
    const id = await ask<string>(window, 'nuphosOpenDockTab', call.session, call.team, target)

    if (id) return text({ id })
  }

  return failed(
    'No Nuphos window could open it. Nuphos Desktop needs a window signed in to this team.',
  )
}
