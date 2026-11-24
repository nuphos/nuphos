// Tells the person when a page in the in-app browser waits for a passkey. Electron shows
// nothing for the request and reaches only security keys, so the page looked hung.
import { BrowserWindow, ipcMain } from 'electron'

import { t } from './i18n.ts'
import { escapeHtml, showWindowNotice } from './local-runtime/window-notice.ts'

import type { Session, WebContents } from 'electron'

const HEIGHT = 112

/** The notice's page. It runs no script: its two links are caught as navigations. */
export function passkeyNoticeHtml(): string {
  const title = t('This site is waiting for a passkey')
  const detail = t(
    'Passkeys saved on this computer or on a phone do not work in this browser yet. Use a security key, or cancel and sign in another way.',
  )

  return `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:transparent;font:13px/1.35 system-ui,-apple-system,sans-serif;overflow:hidden}
.n{box-sizing:border-box;height:100%;display:flex;align-items:center;gap:12px;padding:8px 12px 8px 16px;background:#fff;color:#111;border:1px solid #0000001f;border-radius:12px}
.t{flex:1;min-width:0}.t b,.t span{display:block}.t span{color:#666;font-size:12px}
a{color:#0a66d8;text-decoration:none;white-space:nowrap}.x{color:#888;font-size:18px;padding:0 4px}
</style><div class="n"><div class="t"><b>${escapeHtml(title)}</b><span>${escapeHtml(detail)}</span></div><a href="nuphos-notice:cancel">${escapeHtml(t('Cancel'))}</a><a class="x" href="nuphos-notice:close" title="${escapeHtml(t('Close'))}">×</a></div>`
}

/** The request each page waits on, and how to take its notice down. */
const waiting = new WeakMap<WebContents, { id: number; close: () => void }>()

function show(contents: WebContents, window: BrowserWindow, id: number): void {
  waiting.get(contents)?.close()
  const close = showWindowNotice(window, passkeyNoticeHtml(), {
    height: HEIGHT,
    onLink: (url) => {
      // The page's own request is refused, as when Chrome's passkey window is dismissed.
      if (url === 'nuphos-notice:cancel' && !contents.isDestroyed())
        contents.send('browser-passkey:cancel', id)

      return false
    },
  })

  waiting.set(contents, { id, close })
  // A page that leaves takes its request with it and never reports the end.
  contents.once('did-navigate', close)
}

/** Shows the notice on the browser session's own windows: agents' tabs and sign-in popups. */
export function watchBrowserPasskeys(browserSession: Session): void {
  ipcMain.on('browser-passkey:request', (event, id: unknown, isWaiting: unknown) => {
    const contents = event.sender
    // A Dock tab is a guest inside the app's window, which has no place for this notice.
    const window = contents.getType() === 'window' ? BrowserWindow.fromWebContents(contents) : null

    if (contents.session !== browserSession || !window || typeof id !== 'number') return
    if (isWaiting === true) show(contents, window, id)
    else if (waiting.get(contents)?.id === id) waiting.get(contents)?.close()
  })
}
