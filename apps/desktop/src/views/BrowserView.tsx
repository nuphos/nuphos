import clsx from 'clsx'
import {
  ArrowLeft,
  ArrowRight,
  Globe,
  ExternalLink,
  SquareDashedMousePointer,
  RotateCw,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { api } from '../api'
import { PageMeta } from '../app/pageMeta'
import { BrowserLoadingProgress } from '../components/BrowserLoadingProgress'
import { toast } from '../components/ui/toast'
import { Tooltip } from '../components/ui/tooltip'
import { useCurrentUser } from '../hooks/useCurrentUser'
import { useWorkspaceTab } from '../hooks/useWorkspaceTab'
import { t } from '../i18n'
import { BROWSER_HOME_URL, normalizeBrowserUrl } from '../lib/browserUrl'

import { BrowserCommentBox } from './browser/BrowserCommentBox'
import { registerBrowserView } from '../app/workspace/watchedDockTabs'
import { localPreviewRecorder } from './browser/localPreviewRecorder'
import { focusOpenedPage } from './browser/pageFocus'
import { useBrowserComments } from './browser/useBrowserComments'

import type { WebviewTag } from 'electron'

/** Each mounted dock tab owns its webview and navigation history. */
export function BrowserView({
  teamId,
  url,
  onNavigate,
  onComment,
}: {
  teamId: string
  url?: string
  onNavigate?: (url: string) => void
  /** Receives a page comment for the agent composer, with its screenshot. */
  onComment?: (text: string, filePaths: string[]) => void
}) {
  const [initialUrl] = useState(() => normalizeBrowserUrl(url ?? BROWSER_HOME_URL))
  const lastUrl = useRef(initialUrl)
  const onNavigateRef = useRef(onNavigate)

  useEffect(() => {
    onNavigateRef.current = onNavigate
  }, [onNavigate])
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<WebviewTag | null>(null)
  const { isActive, tabId } = useWorkspaceTab()
  const activeRef = useRef(isActive)

  useEffect(() => {
    activeRef.current = isActive
  }, [isActive])
  const userId = useCurrentUser()?.id
  const previewRef = useRef<ReturnType<typeof localPreviewRecorder> | null>(null)
  const [address, setAddress] = useState(initialUrl)
  const [title, setTitle] = useState(t('Browser'))
  const [nav, setNav] = useState({ back: false, forward: false })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const comments = useBrowserComments(viewRef, onComment)
  const { reset: resetComments } = comments

  useEffect(() => {
    const host = hostRef.current

    if (!host) return
    const view = document.createElement('webview')

    view.setAttribute('src', initialUrl)
    view.setAttribute('partition', 'persist:browser')
    view.setAttribute('allowpopups', '')
    view.setAttribute('webpreferences', 'sandbox=yes,contextIsolation=yes')
    view.style.cssText = 'width:100%;height:100%;display:flex'
    const preview = localPreviewRecorder(view, userId ? { userId, teamId } : undefined)

    previewRef.current = preview

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
      // A new document drops comment mode along with the old page.
      resetComments()
      sync()
    }
    const onInPage = (event: Electron.DidNavigateInPageEvent) => {
      if (!event.isMainFrame) return
      sync()
      void preview.navigatedInPage(activeRef.current)
    }
    let unregister: (() => void) | undefined
    const onReady = () => {
      unregister?.()
      unregister = registerBrowserView(tabId, view)
      setReady(true)
      view.setZoomFactor(1)
      sync()
    }
    const onStart = () => {
      preview.invalidate()
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
      setTitle(event.title || t('Browser'))
    }

    view.addEventListener('dom-ready', onReady)
    view.addEventListener('did-navigate', onDocument)
    view.addEventListener('did-navigate-in-page', onInPage)
    view.addEventListener('did-start-loading', onStart)
    view.addEventListener('did-stop-loading', onStop)
    view.addEventListener('did-fail-load', onFail)
    view.addEventListener('page-title-updated', onTitle)
    host.appendChild(view)
    viewRef.current = view
    if (activeRef.current) focusOpenedPage(view, document)

    return () => {
      unregister?.()
      preview.dispose()
      previewRef.current = null
      view.removeEventListener('dom-ready', onReady)
      view.removeEventListener('did-navigate', onDocument)
      view.removeEventListener('did-navigate-in-page', onInPage)
      view.removeEventListener('did-start-loading', onStart)
      view.removeEventListener('did-stop-loading', onStop)
      view.removeEventListener('did-fail-load', onFail)
      view.removeEventListener('page-title-updated', onTitle)
      view.remove()
      viewRef.current = null
    }
  }, [initialUrl, resetComments, tabId, teamId, userId])

  useEffect(() => {
    if (isActive && ready && !loading && !error) void previewRef.current?.capture()
  }, [error, isActive, loading, ready])

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
            if (!viewRef.current) return
            viewRef.current.src = url
            // Like Chrome, a committed address hands the keyboard to the page.
            viewRef.current.focus()
          }}
        >
          <button
            type="button"
            className={buttonClass}
            disabled={!nav.back}
            onClick={() => viewRef.current?.goBack()}
            aria-label={t('Back')}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className={buttonClass}
            disabled={!nav.forward}
            onClick={() => viewRef.current?.goForward()}
            aria-label={t('Forward')}
          >
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className={buttonClass}
            disabled={!ready}
            onClick={() => (loading ? viewRef.current?.stop() : viewRef.current?.reload())}
            aria-label={loading ? t('Stop loading') : t('Reload page')}
          >
            {loading ? <X className="h-3.5 w-3.5" /> : <RotateCw className="h-3.5 w-3.5" />}
          </button>
          <input
            aria-label={t('Search or enter URL')}
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            onFocus={(event) => event.target.select()}
            spellCheck={false}
            className="ml-1 h-7 min-w-0 flex-1 rounded-md bg-zGray-900 px-2.5 text-xs text-main outline-none focus:ring-1 focus:ring-zGray-600"
            placeholder={t('Search or enter URL')}
          />
          {onComment && (
            <button
              type="button"
              className={clsx(
                buttonClass,
                'ml-1 outline-none focus-visible:ring-2 focus-visible:ring-zViolet-accent',
                comments.active &&
                  '!bg-zViolet-accent/15 !text-zViolet-accent ring-1 ring-inset ring-zViolet-accent/40 hover:!bg-zViolet-accent/25',
              )}
              disabled={!ready}
              onClick={comments.toggle}
              aria-pressed={comments.active}
              aria-label={t('Comment on the page')}
            >
              <SquareDashedMousePointer className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
          <Tooltip content={t('Open in external browser')} side="bottom">
            <button
              type="button"
              className={buttonClass}
              disabled={!ready}
              onClick={() => {
                const currentUrl = viewRef.current?.getURL()

                if (currentUrl && /^https?:\/\//i.test(currentUrl)) {
                  void api.appOpenExternal(currentUrl).catch(() => {
                    toast.error(t('Could not open the external browser'))
                  })
                }
              }}
              aria-label={t('Open in external browser')}
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </Tooltip>
          <BrowserLoadingProgress loading={loading} failed={error !== null} />
        </form>
        {error && (
          <div
            role="alert"
            className="border-b border-error/30 bg-error/10 px-3 py-2 text-xs text-error"
          >
            {t('Could not load this page: {error}. Check the address or reload to retry.', {
              error,
            })}
          </div>
        )}
        <div className="relative min-h-0 flex-1">
          <div ref={hostRef} className="h-full" />
          {comments.draft && (
            <BrowserCommentBox
              key={comments.draft.selector}
              rect={comments.draft.rect}
              onSave={(note) => void comments.save(note)}
              onCancel={comments.cancel}
            />
          )}
        </div>
      </div>
    </PageMeta>
  )
}
