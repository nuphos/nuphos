// The notice an agent's tab shows when it saves a download. The tab is a bare window on the
// page, with no download bar, so without it the person never learns a file arrived.
import { shell, WebContentsView } from 'electron'

import { t } from '../i18n.ts'

import { noticeText } from './agent-downloads.ts'

import type { DownloadState } from './agent-downloads.ts'
import type { BrowserWindow } from 'electron'

const WIDTH = 420
const HEIGHT = 64
/** How long a finished download's notice stays. */
const SHOWN_MS = 15_000

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${String(c.charCodeAt(0))};`)

/** The notice's page. It runs no script: its two links are caught as navigations. */
export function noticeHtml(file: string, state: DownloadState): string {
  const { title, detail } = noticeText(file, state)
  const folder = process.platform === 'darwin' ? t('Show in Finder') : t('Show in folder')
  const reveal = state === 'completed' ? `<a href="nuphos-notice:show">${escape(folder)}</a>` : ''

  return `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:transparent;font:13px/1.35 system-ui,-apple-system,sans-serif;overflow:hidden}
.n{box-sizing:border-box;height:100%;display:flex;align-items:center;gap:12px;padding:0 12px 0 16px;background:#fff;color:#111;border:1px solid #0000001f;border-radius:12px}
.t{flex:1;min-width:0}.t b,.t span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.t span{color:#666}
a{color:#0a66d8;text-decoration:none;white-space:nowrap}.x{color:#888;font-size:18px;padding:0 4px}
</style><div class="n"><div class="t"><b>${escape(title)}</b><span>${escape(detail)}</span></div>${reveal}<a class="x" href="nuphos-notice:close" title="${escape(t('Close'))}">×</a></div>`
}

const notices = new WeakMap<
  BrowserWindow,
  { view: WebContentsView; file: string; timer?: NodeJS.Timeout }
>()

function close(window: BrowserWindow): void {
  const notice = notices.get(window)

  if (!notice) return
  notices.delete(window)
  clearTimeout(notice.timer)
  if (!window.isDestroyed()) window.contentView.removeChildView(notice.view)
  notice.view.webContents.close()
}

/** Shows, at the top of `window`, where `file` stands; a finished one goes away on its own. */
export function showDownloadNotice(
  window: BrowserWindow,
  file: string,
  state: DownloadState,
): void {
  if (window.isDestroyed()) return
  let notice = notices.get(window)

  if (!notice) {
    const view = new WebContentsView({ webPreferences: { sandbox: true, javascript: false } })

    view.setBackgroundColor('#00000000')
    view.webContents.on('will-navigate', (event, url) => {
      event.preventDefault()
      const shown = notices.get(window)

      if (url === 'nuphos-notice:show' && shown) shell.showItemInFolder(shown.file)
      else close(window)
    })
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.contentView.addChildView(view)
    notice = { view, file }
    notices.set(window, notice)
  }
  const [width = 0] = window.getContentSize()

  clearTimeout(notice.timer)
  notice.file = file
  notice.view.setBounds({ x: Math.round((width - WIDTH) / 2), y: 12, width: WIDTH, height: HEIGHT })
  void notice.view.webContents.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(noticeHtml(file, state))}`,
  )
  if (state !== 'progressing') notice.timer = setTimeout(() => close(window), SHOWN_MS)
}
