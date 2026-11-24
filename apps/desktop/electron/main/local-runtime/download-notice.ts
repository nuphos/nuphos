// The notice an agent's tab shows when it saves a download. The tab is a bare window on the
// page, with no download bar, so without it the person never learns a file arrived.
import { shell } from 'electron'

import { t } from '../i18n.ts'

import { noticeText } from './agent-downloads.ts'
import { escapeHtml, showWindowNotice } from './window-notice.ts'

import type { DownloadState } from './agent-downloads.ts'
import type { BrowserWindow } from 'electron'

const HEIGHT = 64
/** How long a finished download's notice stays. */
const SHOWN_MS = 15_000

/** The notice's page. It runs no script: its two links are caught as navigations. */
export function noticeHtml(file: string, state: DownloadState): string {
  const { title, detail } = noticeText(file, state)
  const folder = process.platform === 'darwin' ? t('Show in Finder') : t('Show in folder')
  const reveal =
    state === 'completed' ? `<a href="nuphos-notice:show">${escapeHtml(folder)}</a>` : ''

  return `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:transparent;font:13px/1.35 system-ui,-apple-system,sans-serif;overflow:hidden}
.n{box-sizing:border-box;height:100%;display:flex;align-items:center;gap:12px;padding:0 12px 0 16px;background:#fff;color:#111;border:1px solid #0000001f;border-radius:12px}
.t{flex:1;min-width:0}.t b,.t span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.t span{color:#666}
a{color:#0a66d8;text-decoration:none;white-space:nowrap}.x{color:#888;font-size:18px;padding:0 4px}
</style><div class="n"><div class="t"><b>${escapeHtml(title)}</b><span>${escapeHtml(detail)}</span></div>${reveal}<a class="x" href="nuphos-notice:close" title="${escapeHtml(t('Close'))}">×</a></div>`
}

/**
 * Shows, at the top of `window`, where `file` stands, in place of any notice already there; a
 * finished one goes away on its own, and its Show in Finder reveals its own file.
 */
export function showDownloadNotice(
  window: BrowserWindow,
  file: string,
  state: DownloadState,
): void {
  showWindowNotice(window, noticeHtml(file, state), {
    height: HEIGHT,
    shownMs: state === 'progressing' ? undefined : SHOWN_MS,
    onLink: (url) => {
      if (url !== 'nuphos-notice:show') return false
      shell.showItemInFolder(file)

      return true
    },
  })
}
