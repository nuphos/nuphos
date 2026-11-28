// A notice at the top of a browser window that is a bare page with no bar of its own: an
// agent's tab or a sign-in popup.
import { WebContentsView } from 'electron'

import type { BrowserWindow } from 'electron'

const WIDTH = 420

export const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => `&#${String(c.charCodeAt(0))};`)

/** How to take down each window's notice. */
const notices = new WeakMap<BrowserWindow, () => void>()

/**
 * Shows `html` at the top of `window`, in place of any notice already there, and returns how to
 * take it down. The notice is a view of its own that runs no script: a click on one of its links
 * arrives at `onLink` as a navigation and closes it, unless `onLink` returns true.
 */
export function showWindowNotice(
  window: BrowserWindow,
  html: string,
  options: { height: number; shownMs?: number; onLink?: (url: string) => boolean },
): () => void {
  notices.get(window)?.()
  if (window.isDestroyed()) return () => undefined
  const view = new WebContentsView({ webPreferences: { sandbox: true, javascript: false } })
  const [width = 0] = window.getContentSize()
  let timer: NodeJS.Timeout | undefined
  const close = () => {
    if (notices.get(window) !== close) return
    notices.delete(window)
    clearTimeout(timer)
    window.off('closed', close)
    if (!window.isDestroyed()) window.contentView.removeChildView(view)
    view.webContents.close()
  }

  view.setBackgroundColor('#00000000')
  view.webContents.on('will-navigate', (event, url) => {
    event.preventDefault()
    if (options.onLink?.(url) !== true) close()
  })
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  view.setBounds({
    x: Math.round((width - WIDTH) / 2),
    y: 12,
    width: WIDTH,
    height: options.height,
  })
  window.contentView.addChildView(view)
  window.once('closed', close)
  notices.set(window, close)
  void view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  if (options.shownMs) timer = setTimeout(close, options.shownMs)

  return close
}
