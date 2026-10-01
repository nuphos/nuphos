import { ArrowLeft, ArrowRight, Globe, RotateCw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { PageMeta } from '../app/pageMeta'
import { BrowserLoadingProgress } from '../components/BrowserLoadingProgress'
import { useWorkspaceTab } from '../hooks/useWorkspaceTab'
import { recordBrowserVisit } from '../lib/browserHistory'
import { BROWSER_HOME_URL, normalizeBrowserUrl } from '../lib/browserUrl'

import type { WebviewTag } from 'electron'

/** Each mounted dock tab owns its webview and navigation history. */
export function BrowserView({
  url,
  onNavigate,
  userId,
  teamId,
}: {
  userId: string
  teamId: string
  url?: string
  onNavigate?: (url: string) => void
}) {
  const [initialUrl] = useState(() => normalizeBrowserUrl(url ?? BROWSER_HOME_URL))
  const lastUrl = useRef(initialUrl)
  const onNavigateRef = useRef(onNavigate)

  useEffect(() => {
    onNavigateRef.current = onNavigate
  }, [onNavigate])
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<WebviewTag | null>(null)
  const { refreshKey } = useWorkspaceTab()
  const lastRefresh = useRef(refreshKey)
  const [address, setAddress] = useState(initialUrl)
  const [title, setTitle] = useState('Browser')
  const [nav, setNav] = useState({ back: false, forward: false })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const host = hostRef.current

    if (!host) return
    const view = document.createElement('webview')

    view.setAttribute('src', initialUrl)
    view.setAttribute('partition', 'persist:browser')
    view.setAttribute('allowpopups', '')
    view.setAttribute('webpreferences', 'sandbox=yes,contextIsolation=yes')
    view.style.cssText = 'width:100%;height:100%;display:flex'

    const sync = () => {
      const currentUrl = view.getURL()

      if (/^https?:\/\//i.test(currentUrl)) {
        lastUrl.current = currentUrl
        setAddress(currentUrl)
        onNavigateRef.current?.(currentUrl)
      }
      setNav({ back: view.canGoBack(), forward: view.canGoForward() })
    }
    const onReady = () => {
      setReady(true)
      view.setZoomFactor(1)
      sync()
    }
    const onStart = () => {
      setLoading(true)
      setError(null)
    }
    const onStop = () => {
      setLoading(false)
      sync()
    }
    const onFail = (event: Electron.DidFailLoadEvent) => {
      if (event.isMainFrame && event.errorCode !== -3) {
        setError(event.errorDescription)
        setLoading(false)
      }
    }
    const recordVisit = () => recordBrowserVisit(userId, teamId, view.getURL(), view.getTitle())
    const onTitle = (event: Electron.PageTitleUpdatedEvent) => {
      setTitle(event.title || 'Browser')
      recordBrowserVisit(userId, teamId, view.getURL(), event.title)
    }

    view.addEventListener('dom-ready', onReady)
    view.addEventListener('did-navigate', sync)
    view.addEventListener('did-navigate', recordVisit)
    view.addEventListener('did-navigate-in-page', recordVisit)
    view.addEventListener('did-navigate-in-page', sync)
    view.addEventListener('did-start-loading', onStart)
    view.addEventListener('did-stop-loading', onStop)
    view.addEventListener('did-fail-load', onFail)
    view.addEventListener('page-title-updated', onTitle)
    host.appendChild(view)
    viewRef.current = view

    return () => {
      view.removeEventListener('dom-ready', onReady)
      view.removeEventListener('did-navigate', sync)
      view.removeEventListener('did-navigate', recordVisit)
      view.removeEventListener('did-navigate-in-page', recordVisit)
      view.removeEventListener('did-navigate-in-page', sync)
      view.removeEventListener('did-start-loading', onStart)
      view.removeEventListener('did-stop-loading', onStop)
      view.removeEventListener('did-fail-load', onFail)
      view.removeEventListener('page-title-updated', onTitle)
      view.remove()
      viewRef.current = null
    }
  }, [initialUrl, userId, teamId])

  useEffect(() => {
    if (lastRefresh.current === refreshKey) return
    lastRefresh.current = refreshKey
    if (ready) viewRef.current?.reload()
  }, [refreshKey, ready])

  useEffect(() => {
    if (!url || url === lastUrl.current || !viewRef.current) return
    const next = normalizeBrowserUrl(url)

    lastUrl.current = next
    viewRef.current.src = next
  }, [url])

  const buttonClass =
    'flex h-7 w-7 shrink-0 items-center justify-center rounded text-secondary hover:bg-zGray-800 hover:text-main disabled:opacity-30'

  return (
    <PageMeta pageKey="team.browser" title={title} icon={<Globe className="h-3.5 w-3.5" />}>
      <div className="flex h-full min-h-0 w-full flex-col">
        <form
          className="relative flex items-center gap-1 border-b border-zGray-800 px-2 py-1.5"
          onSubmit={(event) => {
            event.preventDefault()
            const url = normalizeBrowserUrl(address)

            setAddress(url)
            setError(null)
            if (viewRef.current) viewRef.current.src = url
          }}
        >
          <button
            type="button"
            className={buttonClass}
            disabled={!nav.back}
            onClick={() => viewRef.current?.goBack()}
            aria-label="Back"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className={buttonClass}
            disabled={!nav.forward}
            onClick={() => viewRef.current?.goForward()}
            aria-label="Forward"
          >
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className={buttonClass}
            disabled={!ready}
            onClick={() => (loading ? viewRef.current?.stop() : viewRef.current?.reload())}
            aria-label={loading ? 'Stop loading' : 'Reload page'}
          >
            {loading ? <X className="h-3.5 w-3.5" /> : <RotateCw className="h-3.5 w-3.5" />}
          </button>
          <input
            aria-label="Search or enter URL"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            onFocus={(event) => event.target.select()}
            spellCheck={false}
            className="ml-1 h-7 min-w-0 flex-1 rounded-md bg-zGray-900 px-2.5 text-xs text-main outline-none focus:ring-1 focus:ring-zGray-600"
            placeholder="Search or enter URL"
          />
          <BrowserLoadingProgress loading={loading} failed={error !== null} />
        </form>
        {error && (
          <div
            role="alert"
            className="border-b border-error/30 bg-error/10 px-3 py-2 text-xs text-error"
          >
            Could not load this page: {error}. Check the address or reload to retry.
          </div>
        )}
        <div ref={hostRef} className="min-h-0 flex-1" />
      </div>
    </PageMeta>
  )
}
