// A download in a tab an agent opened is saved into one folder with no save dialog, which the
// agent could not answer, and the agent is told where it went (#3299). The person sees it too:
// the tab has no download bar of its own, so a notice says when it starts and where it went.
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

import { t } from '../i18n.ts'

import type { DownloadItem } from 'electron'

/** The largest file an agent's tab may save. */
export const MAX_DOWNLOAD_BYTES = 2 * 1024 ** 3

/** Paths of downloads still in progress, which may not be on disk yet. */
const inProgress = new Set<string>()

const taken = (file: string) => inProgress.has(file) || existsSync(file)

/**
 * Where a file named `suggested` goes in `dir`: under its last path segment without
 * control characters, numbered rather than replacing a file already there.
 */
export function savePath(dir: string, suggested: string, isTaken = taken): string {
  const base = path.posix
    .basename(suggested.replaceAll('\\', '/'))
    .replace(/\p{Cc}/gu, '')
    .trim()
  const name = base === '' || base === '.' || base === '..' ? 'download' : base
  const { name: stem, ext } = path.parse(name)
  let file = path.join(dir, name)
  let n = 0

  while (isTaken(file)) {
    n += 1
    file = path.join(dir, `${stem} (${String(n)})${ext}`)
  }

  return file
}

type Download = Pick<
  DownloadItem,
  'getFilename' | 'getTotalBytes' | 'getReceivedBytes' | 'setSavePath' | 'cancel'
> & {
  on(event: 'updated', listener: () => void): unknown
  once(event: 'done', listener: (event: unknown, state: string) => void): unknown
}

/** Where a download stands, for the person's notice. */
export type DownloadState = 'progressing' | 'completed' | 'failed'

/** What the notice for `file` says, with the folder as the person knows it. */
export function noticeText(file: string, state: DownloadState, home = homedir()) {
  const name = path.basename(file)
  const dir = path.dirname(file)
  const folder =
    dir === home || dir.startsWith(home + path.sep) ? `~${dir.slice(home.length)}` : dir

  if (state === 'progressing')
    return {
      title: t('Downloading {name}…', { name }),
      detail: t('Saving to {folder}', { folder }),
    }
  if (state === 'completed')
    return { title: t('Downloaded {name}', { name }), detail: t('Saved to {folder}', { folder }) }

  return { title: t('{name} was not downloaded', { name }), detail: '' }
}

/**
 * Saves `download` in `dir`, reports how it ended to the agent and tells the person through
 * `notify`. The file is never opened.
 */
export function saveDownload(
  download: Download,
  dir: string,
  report: (line: string) => void,
  notify: (file: string, state: DownloadState) => void,
) {
  const file = savePath(dir, download.getFilename())
  const tooLarge = () =>
    Math.max(download.getTotalBytes(), download.getReceivedBytes()) > MAX_DOWNLOAD_BYTES

  mkdirSync(dir, { recursive: true })
  inProgress.add(file)
  download.setSavePath(file)
  download.once('done', (_event, state) => {
    inProgress.delete(file)
    const bytes = String(download.getReceivedBytes())

    notify(file, state === 'completed' ? 'completed' : 'failed')
    if (state === 'completed') report(`Downloaded: ${file} (completed, ${bytes} bytes)`)
    else if (tooLarge()) report(`Download cancelled: ${file} is larger than 2 GB.`)
    else report(`Download ${state}: ${file} (${bytes} bytes)`)
  })
  download.on('updated', () => {
    if (tooLarge()) download.cancel()
  })
  notify(file, 'progressing')
  if (tooLarge()) download.cancel()
}

/** How each agent tab saves its downloads; a page that is not one has none. */
const savers = new WeakMap<object, (download: DownloadItem) => void>()
/** What became of each conversation's downloads since it was last told. */
const news = new Map<string, string[]>()

/** Makes `contents`, a tab of `conversation`, save its downloads in `dir()` with no dialog. */
export function saveDownloadsOf(
  contents: object,
  conversation: string,
  dir: () => string,
  notify: (file: string, state: DownloadState) => void,
) {
  savers.set(contents, (download) =>
    saveDownload(
      download,
      dir(),
      (line) => news.set(conversation, [...(news.get(conversation) ?? []), line]),
      notify,
    ),
  )
}

/** `result` with what became of the conversation's downloads since it was last told. */
export function withDownloadNews<T extends { content: unknown[] }>(
  conversation: string,
  result: T,
): T {
  const lines = news.get(conversation)

  if (!lines) return result
  news.delete(conversation)

  return { ...result, content: [...result.content, { type: 'text', text: lines.join('\n') }] }
}

/** Saves `download` if its page is an agent tab, and says whether it did. */
export function saveAgentDownload(download: DownloadItem, contents: object | undefined): boolean {
  const save = contents && savers.get(contents)

  if (!save) return false
  save(download)

  return true
}
