import path from 'node:path'

import { app, BrowserWindow, ipcMain, screen } from 'electron'

import { readConfig } from '../auth/config'
import { authSession } from '../auth-session'

import {
  DEFAULT_WINDOW_SIZE,
  MAX_SAVED_WINDOWS,
  accountWhenKnown,
  fitBoundsToDisplays,
  parseWindowSurface,
  readWindowSession,
  restorableSurface,
  writeWindowSession,
} from './window-session-core'

import type { Rect, SavedWindow } from './window-session-core'

export type WindowPlacement = {
  bounds: Partial<Rect> & { width: number; height: number }
  maximized: boolean
  fullScreen: boolean
}

// Every app window's latest state, in creation order. A window the user
// closes leaves; one that closes because the app is quitting stays, and so
// does the last window on macOS, where closing it does not quit.
const tracked = new Map<BrowserWindow, SavedWindow>()
let quitting = false
let saveTimer: ReturnType<typeof setTimeout> | null = null
let reports: Promise<void> = Promise.resolve()

function sessionFile(): string {
  return path.join(app.getPath('userData'), 'window-session.json')
}

function currentAccount(): Promise<string | null> {
  return accountWhenKnown(authSession, readConfig)
}

function saveNow() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  writeWindowSession(sessionFile(), {
    version: 1,
    windows: [...tracked.values()].slice(0, MAX_SAVED_WINDOWS),
  })
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(saveNow, 500)
}

/** The windows to reopen at launch; empty means one default window. */
export function readSavedWindows(): SavedWindow[] {
  return readWindowSession(sessionFile()).windows
}

/** A window closed while others stay open is not reopened; this marks the closes that follow as the app's own. */
export function markAppQuitting() {
  if (quitting) return
  quitting = true
  saveNow()
}

/** The last closed window, when none is open: macOS reopens it where it was. */
export function lastClosedWindow(): SavedWindow | null {
  const live = [...tracked.keys()].some((win) => !win.isDestroyed())

  return live ? null : ([...tracked.values()].at(-1) ?? null)
}

export function placementFor(saved: SavedWindow | null): WindowPlacement {
  if (!saved) return { bounds: { ...DEFAULT_WINDOW_SIZE }, maximized: false, fullScreen: false }
  const primary = screen.getPrimaryDisplay().workArea
  const workAreas = screen.getAllDisplays().map((display) => display.workArea)

  return {
    bounds: fitBoundsToDisplays(saved.bounds, workAreas, primary),
    maximized: saved.maximized,
    fullScreen: saved.fullScreen,
  }
}

function snapshot(win: BrowserWindow, previous: SavedWindow): SavedWindow {
  return {
    ...previous,
    // The size it returns to when un-maximized, so a maximized window keeps both.
    bounds: win.getNormalBounds(),
    maximized: win.isMaximized(),
    fullScreen: win.isFullScreen(),
  }
}

export function trackWindow(win: BrowserWindow, restored: SavedWindow | null) {
  for (const other of tracked.keys()) if (other.isDestroyed()) tracked.delete(other)
  tracked.set(
    win,
    snapshot(win, {
      bounds: win.getNormalBounds(),
      maximized: false,
      fullScreen: false,
      account: restored?.account ?? null,
      surface: restored?.surface ?? null,
    }),
  )
  const update = () => {
    const previous = tracked.get(win)

    if (!previous || win.isDestroyed()) return
    tracked.set(win, snapshot(win, previous))
    scheduleSave()
  }

  win.on('resize', update)
  win.on('move', update)
  win.on('maximize', update)
  win.on('unmaximize', update)
  win.on('enter-full-screen', update)
  win.on('leave-full-screen', update)
  win.on('close', () => {
    update()
    const others = [...tracked.keys()].some((other) => other !== win && !other.isDestroyed())

    if (!quitting && others) {
      tracked.delete(win)
      scheduleSave()
    }
  })
  scheduleSave()
}

export function initWindowSessionChannels() {
  ipcMain.handle('window-session:take-surface', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const saved = win ? tracked.get(win) : undefined

    return saved ? restorableSurface(saved, await currentAccount()) : null
  })
  ipcMain.on('window-session:report-surface', (event, raw: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const surface = parseWindowSurface(raw)

    if (!win || !surface) return
    // In order, so a report waiting on the config file never lands after a newer one.
    reports = reports.then(async () => {
      const account = await currentAccount()
      const saved = tracked.get(win)

      // Without a known account the surface could never be restored; keep the saved one.
      if (!saved || win.isDestroyed() || account === null) return
      tracked.set(win, { ...saved, account, surface })
      scheduleSave()
    })
  })
}
