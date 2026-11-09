import type { DownloadItem, Session, WebContents } from 'electron'

/**
 * Whether a download should be dropped as a repeat of one already asked about.
 *
 * A Dock tab whose address is a file (an agent opened a PDF or .docx link) has
 * no page: loading the tab is the download. The tab reloads each time it moves
 * or remounts, so the save dialog came back on every chat switch even after the
 * user cancelled it. Such a tab asks once per file in a run. A download started
 * from a link on a loaded page always asks.
 */
export function isRepeatTabDownload(
  asked: Set<string>,
  item: Pick<DownloadItem, 'getURL' | 'getURLChain'>,
  contents: Pick<WebContents, 'getURL'> | undefined,
): boolean {
  const chain = item.getURLChain()
  const url = chain[0] ?? item.getURL()
  const page = contents?.getURL() ?? ''

  if (page !== '' && page !== 'about:blank' && !chain.includes(page)) return false
  if (asked.has(url)) return true
  asked.add(url)

  return false
}

/** Cancels the browser session's repeated tab downloads before Electron shows a save dialog. */
export function guardBrowserDownloads(browserSession: Pick<Session, 'on'>) {
  const asked = new Set<string>()

  browserSession.on('will-download', (event, item, contents) => {
    if (isRepeatTabDownload(asked, item, contents)) event.preventDefault()
  })
}
