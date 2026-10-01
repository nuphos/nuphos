import { ArrowUpRight } from 'lucide-react'
import { useCallback, useEffect, useRef } from 'react'

import { api } from '../api'
import { reportFrontendError } from '../lib/frontendErrorReporter'

import { Modal } from './Modal'

import type { ChangelogEntry } from '../types/team'

const LOAD_TIMEOUT_MS = 12_000

function formatDate(iso: string): string {
  const t = Date.parse(iso)

  return Number.isNaN(t)
    ? iso
    : new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/**
 * In-app reader for one changelog entry: a webview onto the website's
 * ?embed=1 rendering (chrome-less), locked to the changelog origin by the
 * main-process webview guard. Any load failure falls back to the system
 * browser — the entry is always reachable.
 */
export function WhatsNewReader({ entry, onClose }: { entry: ChangelogEntry; onClose: () => void }) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const fellBackRef = useRef(false)

  const openInBrowser = useCallback(() => {
    if (fellBackRef.current) return
    fellBackRef.current = true
    void api.appOpenExternal(entry.url)
    onClose()
  }, [entry.url, onClose])
  const fallbackToBrowser = useCallback(
    (reason: string) => {
      if (fellBackRef.current) return
      reportFrontendError({
        source: 'webview',
        phase: 'changelog_load_failed',
        message: reason,
      })
      openInBrowser()
    },
    [openInBrowser],
  )

  // The webview-creating effect below only depends on [entry.url] so a
  // reader stays mounted (no reload, no timer restart) across re-renders
  // that don't change which entry is open. It reads the latest
  // fallbackToBrowser through this ref rather than closing over it directly.
  const fallbackToBrowserRef = useRef(fallbackToBrowser)

  useEffect(() => {
    fallbackToBrowserRef.current = fallbackToBrowser
  })

  useEffect(() => {
    const host = hostRef.current

    if (!host) return

    const view = document.createElement('webview')
    const embedUrl = new URL(entry.url)

    embedUrl.searchParams.set('embed', '1')
    view.setAttribute('src', embedUrl.toString())
    view.style.width = '100%'
    view.style.height = '100%'
    view.style.display = 'flex'

    let loaded = false
    const onFinish = () => {
      loaded = true
    }
    const onFail = (e: Event & { errorCode?: number; isMainFrame?: boolean }) => {
      // Ignore sub-frame/sub-resource failures (isMainFrame === false — a
      // broken image or analytics beacon inside the page) and benign aborted
      // navigations (errorCode === -3, ERR_ABORTED, fired when an in-flight
      // request is cancelled by a redirect or new navigation) — neither means
      // the changelog page itself failed to load.
      if (e.isMainFrame === false || e.errorCode === -3) return
      fallbackToBrowserRef.current(
        `Changelog webview failed to load (error code ${String(e.errorCode ?? 'unknown')}).`,
      )
    }

    view.addEventListener('did-finish-load', onFinish)
    view.addEventListener('did-fail-load', onFail)
    const timer = setTimeout(() => {
      if (!loaded) fallbackToBrowserRef.current('Changelog webview timed out while loading.')
    }, LOAD_TIMEOUT_MS)

    host.appendChild(view)

    return () => {
      clearTimeout(timer)
      view.removeEventListener('did-finish-load', onFinish)
      view.removeEventListener('did-fail-load', onFail)
      view.remove()
    }
  }, [entry.url])

  return (
    <Modal
      open
      onClose={onClose}
      title={formatDate(entry.date)}
      width={720}
      fillHeight
      headerCompact
      headerActions={
        <button
          type="button"
          onClick={openInBrowser}
          title="Open in browser"
          aria-label="Open in browser"
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-tertiary outline-none transition-colors hover:bg-zGray-800 hover:text-main"
        >
          <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      }
    >
      <div ref={hostRef} className="h-full w-full" />
    </Modal>
  )
}
