import clsx from 'clsx'
import { ArrowLeft, ArrowRight, Globe, MousePointerClick, RotateCw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { PageMeta } from '../app/pageMeta'
import { BrowserLoadingProgress } from '../components/BrowserLoadingProgress'
import { useWorkspaceTab } from '../hooks/useWorkspaceTab'
import {
  CANCEL_PICK_SCRIPT,
  formatPickedElement,
  PICK_ELEMENT_SCRIPT,
} from '../lib/browserAnnotate'
import { BROWSER_HOME_URL, normalizeBrowserUrl } from '../lib/browserUrl'

import type { WebviewTag } from 'electron'

/** Each mounted dock tab owns its webview and navigation history. */
export function BrowserView({
  url,
  onNavigate,
  onAnnotate,
}: {
  url?: string
  onNavigate?: (url: string) => void
  /** Receives a picked element, formatted for the agent composer. */
  onAnnotate?: (text: string) => void
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
  const [picking, setPicking] = useState(false)
  // Identifies the current pick; a pick left behind by navigation never
  // resolves into this one's state.
  const pickRef = useRef(0)

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
    const onDocument = () => {
      // A new document drops any pick running in the old one.
      pickRef.current += 1
      setPicking(false)
      sync()
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
    const onTitle = (event: Electron.PageTitleUpdatedEvent) => {
      setTitle(event.title || 'Browser')
    }

    view.addEventListener('dom-ready', onReady)
    view.addEventListener('did-navigate', onDocument)
    view.addEventListener('did-navigate-in-page', sync)
    view.addEventListener('did-start-loading', onStart)
    view.addEventListener('did-stop-loading', onStop)
    view.addEventListener('did-fail-load', onFail)
    view.addEventListener('page-title-updated', onTitle)
    host.appendChild(view)
    viewRef.current = view

    return () => {
      view.removeEventListener('dom-ready', onReady)
      view.removeEventListener('did-navigate', onDocument)
      view.removeEventListener('did-navigate-in-page', sync)
      view.removeEventListener('did-start-loading', onStart)
      view.removeEventListener('did-stop-loading', onStop)
      view.removeEventListener('did-fail-load', onFail)
      view.removeEventListener('page-title-updated', onTitle)
      view.remove()
      viewRef.current = null
    }
  }, [initialUrl])

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

  const annotate = () => {
    const view = viewRef.current

    if (!view || !onAnnotate) return
    if (picking) {
      void view.executeJavaScript(CANCEL_PICK_SCRIPT).catch(() => {})

      return
    }
    const pick = ++pickRef.current

    setPicking(true)
    void view
      .executeJavaScript(PICK_ELEMENT_SCRIPT)
      .then((picked: unknown) => {
        const text = pick === pickRef.current && formatPickedElement(view.getURL(), picked)

        if (text) onAnnotate(text)
      })
      .catch(() => {})
      .finally(() => {
        if (pick === pickRef.current) setPicking(false)
      })
  }

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
          {onAnnotate && (
            <button
              type="button"
              className={clsx(buttonClass, picking && 'bg-zGray-800 text-main')}
              disabled={!ready}
              onClick={annotate}
              aria-pressed={picking}
              aria-label={picking ? 'Cancel element pick' : 'Pick an element for the agent'}
              title={picking ? 'Cancel (Esc)' : 'Pick an element for the agent'}
            >
              <MousePointerClick className="h-3.5 w-3.5" />
            </button>
          )}
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
