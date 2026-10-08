import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { BrowserWindow, ipcMain, shell } from 'electron'

import * as k8s from '../k8s'
import * as podExec from '../pod-exec'
import * as terminal from '../terminal'
import { raiseWindow } from '../window-raise'

import { flushPendingDeepLinks } from './deep-links'
import { APP_NAME, isDev } from './env'
import { TITLEBAR_ROW_H, titleBarOverlayFor } from './window-titlebar'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const appWindows = new Set<BrowserWindow>()
const appWindowFocusOrder: BrowserWindow[] = []

type AppShortcut =
  | 'new-chat'
  | 'new-tab'
  | 'close-tab'
  | 'previous-tab'
  | 'next-tab'
  | 'open-settings'
  | 'open-team-settings'
  | 'toggle-sidebar'
  | 'toggle-dock-expanded'
  | 'shortcuts-help'
  | 'reopen-closed-tab'
  | `select-tab-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`

function rememberAppWindowFocus(win: BrowserWindow) {
  const index = appWindowFocusOrder.indexOf(win)

  if (index !== -1) appWindowFocusOrder.splice(index, 1)
  appWindowFocusOrder.push(win)
}

function forgetAppWindow(win: BrowserWindow) {
  appWindows.delete(win)
  const index = appWindowFocusOrder.indexOf(win)

  if (index !== -1) appWindowFocusOrder.splice(index, 1)
}

function mostRecentlyFocusedAppWindow(except?: BrowserWindow): BrowserWindow | null {
  for (let index = appWindowFocusOrder.length - 1; index >= 0; index -= 1) {
    const win = appWindowFocusOrder[index]

    if (win === except || win.isDestroyed() || !appWindows.has(win)) continue

    return win
  }

  return [...appWindows].find((win) => win !== except && !win.isDestroyed()) ?? null
}

export function mostRecentlyFocusedVisibleAppWindow(except?: BrowserWindow): BrowserWindow | null {
  for (let index = appWindowFocusOrder.length - 1; index >= 0; index -= 1) {
    const win = appWindowFocusOrder[index]

    if (win === except || win.isDestroyed() || !appWindows.has(win) || !win.isVisible()) continue

    return win
  }

  return (
    [...appWindows].find((win) => win !== except && !win.isDestroyed() && win.isVisible()) ?? null
  )
}

export function focusedAppWindow(): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow()

  if (focused && appWindows.has(focused)) return focused

  return mostRecentlyFocusedAppWindow()
}

export function showMainWindow(): BrowserWindow {
  const existing = focusedAppWindow()

  if (existing) {
    raiseWindow(existing)

    return existing
  }

  // A freshly created window starts hidden (show: false) and reveals itself
  // via its own 'ready-to-show' handler. Calling raiseWindow() here would fire
  // win.show() before the first paint, causing the blank-window flash the
  // ready-to-show pattern exists to prevent.
  return createWindow()
}

export function dispatchAppShortcut(action: AppShortcut) {
  const win = showMainWindow()

  win.webContents.send('app:shortcut', action)
}

// macOS traffic lights are OS-drawn at a fixed size and ignore page zoom. The
// leading edge stays put (they're always left-most; the CSS insets counter-scale
// to keep content beside them), but the titlebar row grows/shrinks with zoom, so
// place them at the exact geometric centre of the shared 44px titlebar row.
// At factor 1 this is {14, 15}.
const TRAFFIC_LIGHT_H = 14 // approx button height (pt), constant across zoom
const TRAFFIC_LIGHT_LEAD = 14 // leading margin (constant — buttons are fixed-size)

function trafficLightPositionFor(factor: number): { x: number; y: number } {
  return {
    // Scales with zoom like the row height does. The buttons are fixed-size, but
    // the gap beside them is part of the layout, so it grows with everything
    // else — the CSS reserve in index.css scales in step.
    x: Math.round(TRAFFIC_LIGHT_LEAD * factor),
    y: Math.round((TITLEBAR_ROW_H * factor - TRAFFIC_LIGHT_H) / 2),
  }
}

export function createWindow(): BrowserWindow {
  const isDarwin = process.platform === 'darwin'
  const isWindows = process.platform === 'win32'
  const win = new BrowserWindow({
    title: APP_NAME,
    width: 1400,
    height: 880,
    minWidth: 900,
    minHeight: 600,
    // macOS keeps the inset native traffic lights. Every other platform gets a
    // fully frameless window (no native frame, no menu bar) so our custom
    // titlebar is the entire chrome and the app looks native. On Windows the
    // `hiddenInset` value was silently ignored and fell back to a full native
    // frame + menu — `hidden` is the supported value there.
    // 'hidden' (not 'hiddenInset') on macOS so `trafficLightPosition` /
    // `setWindowButtonPosition` take effect — we move the buttons to track page
    // zoom (cmd +/-), which the OS-drawn controls otherwise ignore.
    titleBarStyle: 'hidden',
    ...(isDarwin ? { trafficLightPosition: trafficLightPositionFor(1) } : {}),
    // Windows and Linux: draw the native minimize/maximize/close caption buttons
    // as an overlay on the top-right of our custom titlebar. Transparent
    // background lets them sit over whatever chrome color the active theme
    // paints, and the height is the titlebar row's own so they line up with the
    // tab strip they overlap.
    ...titleBarOverlayFor(process.platform),
    // macOS paints the sidebar region with native vibrancy/blur; Windows 11 gets
    // the equivalent via the Mica backdrop material. Both need a transparent
    // window background so the material shows through where the renderer leaves
    // gaps (root + translucent `.sidebar-surface`). Linux has no backdrop API, so
    // it keeps the opaque background to avoid flashes during load.
    ...(isDarwin
      ? { vibrancy: 'sidebar' as const, visualEffectState: 'active' as const }
      : isWindows
        ? { backgroundColor: '#00000000', backgroundMaterial: 'mica' as const }
        : { backgroundColor: '#0f0e11' }),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Use the native macOS rubber-band effect when a scroll container reaches
      // either edge. Other platforms keep Chromium's default scroll behavior.
      scrollBounce: isDarwin,
      // Used by the What's New reader and Browser dock tabs; webview-guard
      // enforces isolated browser sessions and restricts the reader to the
      // changelog origin by initWebviewGuard().
      webviewTag: true,
    },
  })

  const publishFullScreen = () => {
    if (!win.isDestroyed()) win.webContents.send('app:fullScreenChanged', win.isFullScreen())
  }

  win.on('enter-full-screen', publishFullScreen)
  win.on('leave-full-screen', publishFullScreen)
  win.webContents.on('did-finish-load', publishFullScreen)

  appWindows.add(win)
  rememberAppWindowFocus(win)

  win.once('ready-to-show', () => {
    win.show()
    // Readiness marker for scripts/dev-desktop.ts.
    if (isDev) console.log('[nuphos-dev] electron window opened')
  })
  win.on('focus', () => rememberAppWindowFocus(win))
  win.on('closed', () => {
    forgetAppWindow(win)
    // These teardown APIs are global (they close every active session, not
    // just this window's), so running them per-window would drop sessions
    // still in use by other open windows. On macOS, closing the final window
    // doesn't quit the app (before-quit won't fire), so tear the global
    // streams down here once the last tracked window is gone — otherwise their
    // websockets (and the remote exec shells behind them) would outlive the UI.
    if (appWindows.size === 0) {
      k8s.stopAllPortForwards()
      terminal.closeAllSshSessions()
      podExec.closeAllPodExecSessions()
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch((e: unknown) => {
      console.error('[open-external]', url, e)
    })

    return { action: 'deny' }
  })

  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[did-fail-load]', code, desc, url)
  })

  win.webContents.on('did-finish-load', () => {
    flushPendingDeepLinks(win)
  })

  // A queued deep link raised this window; retry as soon as it is usable again
  // (the new document's listeners attach shortly after focus).
  win.on('focus', () => {
    flushPendingDeepLinks(win)
  })

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat) return
    const key = input.key.toLowerCase()
    const code = input.code
    const commandOrControl = input.meta || input.control

    if (!commandOrControl || input.alt) return

    // preventDefault also stops the matching macOS menu accelerator from
    // firing, so each combo dispatches exactly once.
    const sendShortcut = (action: AppShortcut) => {
      event.preventDefault()
      win.webContents.send('app:shortcut', action)
    }

    if (input.shift && key === 'n') {
      event.preventDefault()
      createWindow()
    } else if (!input.shift && key === 'n') {
      sendShortcut('new-chat')
    } else if (!input.shift && key === 't') {
      sendShortcut('new-tab')
    } else if (!input.shift && key === 'w') {
      sendShortcut('close-tab')
    } else if (input.shift && (key === '[' || key === '{' || code === 'BracketLeft')) {
      sendShortcut('previous-tab')
    } else if (input.shift && (key === ']' || key === '}' || code === 'BracketRight')) {
      sendShortcut('next-tab')
    } else if (input.shift && (key === ',' || key === '<' || code === 'Comma')) {
      sendShortcut('open-team-settings')
    } else if (!input.shift && key === ',') {
      sendShortcut('open-settings')
    } else if (!input.shift && key === 'b') {
      sendShortcut('toggle-sidebar')
    } else if (input.shift && key === 'enter') {
      sendShortcut('toggle-dock-expanded')
    } else if (!input.shift && (key === '/' || code === 'Slash')) {
      sendShortcut('shortcuts-help')
    } else if (input.shift && key === 't') {
      sendShortcut('reopen-closed-tab')
    } else if (!input.shift && /^[1-9]$/.test(key)) {
      sendShortcut(`select-tab-${key}` as AppShortcut)
    }
  })

  const startUrl = isDev ? process.env.VITE_DEV_SERVER_URL! : 'app://./index.html'

  win.loadURL(startUrl).catch((e: unknown) => {
    console.error('[load-url]', startUrl, e)
  })

  return win
}

// The renderer pings on every page-zoom change (cmd +\/-); move the native
// traffic lights to track the zoomed titlebar. macOS only.
ipcMain.on('app:zoomChanged', (event) => {
  if (process.platform !== 'darwin') return
  const win = BrowserWindow.fromWebContents(event.sender)

  if (!win || win.isDestroyed()) return
  event.sender.send('app:fullScreenChanged', win.isFullScreen())
  win.setWindowButtonPosition(trafficLightPositionFor(event.sender.getZoomFactor()))
})
