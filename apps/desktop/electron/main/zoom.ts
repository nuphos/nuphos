import { BrowserWindow, ipcMain } from 'electron'

import { TITLEBAR_ROW_H } from './window-titlebar'

import type { WebContents } from 'electron'

export type ZoomStep = 'in' | 'out' | 'reset'

// Page zoom always targets the app window's own webContents. Electron's
// zoomIn / zoomOut menu roles zoom the *focused* webContents, which prefers any
// <webview> that reports focus (desktop and browser panes), so they left the
// app itself unzoomed. Off macOS there is no menu at all, so the window's
// before-input-event handler calls this too.
export function zoom(contents: WebContents, step: ZoomStep) {
  if (step === 'reset') {
    contents.zoomLevel = 0

    return
  }
  // 0.5 is the level step Chromium and Electron's own roles use.
  contents.zoomLevel += step === 'in' ? 0.5 : -0.5
}

/** ⌘= / ⌘+ / ⌘- / ⌘0, with the modifier already checked by the caller. */
export function zoomStepForKey(key: string): ZoomStep | null {
  if (key === '=' || key === '+') return 'in'
  if (key === '-') return 'out'

  return key === '0' ? 'reset' : null
}

// macOS traffic lights are OS-drawn at a fixed size and ignore page zoom. The
// leading edge stays put (they're always left-most; the CSS insets counter-scale
// to keep content beside them), but the titlebar row grows/shrinks with zoom, so
// place them at the exact geometric centre of the shared 44px titlebar row.
// At factor 1 this is {14, 15}.
const TRAFFIC_LIGHT_H = 14 // approx button height (pt), constant across zoom
const TRAFFIC_LIGHT_LEAD = 14 // leading margin (constant — buttons are fixed-size)

export function trafficLightPositionFor(factor: number): { x: number; y: number } {
  return {
    // Scales with zoom like the row height does. The buttons are fixed-size, but
    // the gap beside them is part of the layout, so it grows with everything
    // else — the CSS reserve in index.css scales in step.
    x: Math.round(TRAFFIC_LIGHT_LEAD * factor),
    y: Math.round((TITLEBAR_ROW_H * factor - TRAFFIC_LIGHT_H) / 2),
  }
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
