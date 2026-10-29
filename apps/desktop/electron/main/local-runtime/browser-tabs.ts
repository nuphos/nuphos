import { app, session, webContents } from 'electron'

import { handleDeepLink } from '../deep-links.ts'

import { failed } from './cua-host.ts'

import type { BrowserCall } from './browser-stream.ts'
import type { CuaToolResult } from './cua-host.ts'
import type { WebContents } from 'electron'

/** How long Desktop may take to attach the tab and start its page. */
const OPEN_TIMEOUT_MS = 15_000
const LOAD_TIMEOUT_MS = 20_000
/** The longest one call into a tab's page may run. */
const CALL_TIMEOUT_MS = 30_000

const isHttp = (url: string | undefined): url is string =>
  url !== undefined && /^https?:\/\//i.test(url)

const text = (value: unknown): CuaToolResult => ({
  content: [
    {
      type: 'text',
      text: typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2),
    },
  ],
})

/** The conversation whose `open` created each tab. */
const openers = new WeakMap<WebContents, string>()

/** The browser tabs this conversation opened, so one conversation never drives another's. */
function browserTabs(conversation: string): WebContents[] {
  return webContents
    .getAllWebContents()
    .filter((c) => !c.isDestroyed() && openers.get(c) === conversation)
}

function describe(contents: WebContents) {
  return {
    tab: contents.id,
    url: contents.getURL(),
    title: contents.getTitle(),
    loading: contents.isLoading(),
  }
}

/** Resolves once the page stops loading, or after the timeout either way. */
function loaded(contents: WebContents): Promise<void> {
  if (!contents.isLoading()) return Promise.resolve()

  return new Promise((resolve) => {
    const timer = setTimeout(resolve, LOAD_TIMEOUT_MS)

    contents.once('did-stop-loading', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

/**
 * `work` on a tab, failed instead once the tab closes or crashes, `ms` pass, or
 * (with `untilNavigation`) its page is replaced by a new document. Electron
 * never settles a call whose page goes away, so without this the call hangs.
 */
function onPage<T>(
  contents: WebContents,
  work: Promise<T>,
  { untilNavigation = false, ms = CALL_TIMEOUT_MS } = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const fail = (message: string) => {
      stop()
      reject(new Error(message))
    }
    const onNavigation = (details: {
      url: string
      isMainFrame: boolean
      isSameDocument: boolean
    }) => {
      if (details.isMainFrame && !details.isSameDocument)
        fail(
          `The tab navigated to ${details.url} before the script finished, so its result is lost. Run eval again on the new page.`,
        )
    }
    const onGone = () => fail('The tab closed or crashed during the call.')
    const timer = setTimeout(
      () => fail(`The call did not finish within ${String(ms / 1000)}s.`),
      ms,
    )
    const stop = () => {
      clearTimeout(timer)
      contents.off('did-start-navigation', onNavigation)
      contents.off('destroyed', onGone)
      contents.off('render-process-gone', onGone)
    }

    if (untilNavigation) contents.on('did-start-navigation', onNavigation)
    contents.on('destroyed', onGone)
    contents.on('render-process-gone', onGone)
    work.finally(stop).then(resolve, reject)
  })
}

const sameUrl = (a: string, b: string) => URL.canParse(a) && new URL(a).href === new URL(b).href

/**
 * The tab an `open` created: a browser guest attached after the request whose
 * main frame starts loading `url`, returned once that load stops (finished or
 * failed). Null if none does in time; a claimed tab still loading at the
 * deadline is returned as it is.
 */
function openedTab(url: string, conversation: string): Promise<WebContents | null> {
  const browser = session.fromPartition('persist:browser')

  return new Promise((resolve) => {
    const candidates = new Map<
      WebContents,
      (details: { url: string; isMainFrame: boolean }) => void
    >()
    let tab: WebContents | null = null
    const stopWatching = () => {
      app.off('web-contents-created', onCreated)
      for (const [contents, onNavigation] of candidates)
        contents.off('did-start-navigation', onNavigation)
      candidates.clear()
    }
    const finish = () => {
      clearTimeout(timer)
      stopWatching()
      resolve(tab)
    }
    const onCreated = (_event: Electron.Event, contents: WebContents) => {
      if (contents.getType() !== 'webview' || contents.session !== browser) return
      const onNavigation = (details: { url: string; isMainFrame: boolean }) => {
        // A tab another open already took stays theirs, so overlapping opens never share one.
        if (!details.isMainFrame || !sameUrl(details.url, url) || openers.has(contents)) return
        openers.set(contents, conversation)
        tab = contents
        stopWatching()
        contents.once('did-stop-loading', finish)
      }

      candidates.set(contents, onNavigation)
      contents.on('did-start-navigation', onNavigation)
    }
    const timer = setTimeout(finish, OPEN_TIMEOUT_MS + LOAD_TIMEOUT_MS)

    app.on('web-contents-created', onCreated)
  })
}

/** Runs one `local_browser` action against the workspace's browser tabs. */
export async function runBrowserCall(call: BrowserCall): Promise<CuaToolResult> {
  // Without a conversation, tabs nobody opened (the app's own renderer included) would match.
  if (!call.session) return failed('session is required.')
  if (call.action === 'tabs') return text(browserTabs(call.session).map(describe))
  if (call.action === 'open') {
    if (!isHttp(call.url)) return failed('url must be an http(s) URL.')
    const opened = openedTab(call.url, call.session)
    const path = `/teams/${encodeURIComponent(call.team)}/browser?url=${encodeURIComponent(call.url)}`

    handleDeepLink(
      `nuphos://open?path=${encodeURIComponent(path)}&session=${encodeURIComponent(call.session)}`,
    )
    const contents = await opened

    if (!contents)
      return failed(
        'No browser tab opened. Nuphos Desktop needs an open window signed in to this team.',
      )

    return text(describe(contents))
  }
  const contents = browserTabs(call.session).find((c) => c.id === call.tab)

  if (!contents)
    return failed(
      `Tab ${String(call.tab)} is not one this conversation opened; list its tabs with action "tabs".`,
    )
  if (call.action === 'navigate') {
    if (!isHttp(call.url)) return failed('url must be an http(s) URL.')
    // A failed load still leaves the tab on its error page, which `describe` reports.
    await onPage(contents, contents.loadURL(call.url), { ms: LOAD_TIMEOUT_MS }).catch(() => {})

    return text(describe(contents))
  }
  if (call.action === 'eval') {
    if (!call.script) return failed('script is required.')
    // A user gesture lets the script click through what only a real click may open.
    const value: unknown = await onPage(contents, contents.executeJavaScript(call.script, true), {
      untilNavigation: true,
    })

    await loaded(contents)

    return text(value === undefined ? 'undefined' : value)
  }
  const image = await onPage(contents, contents.capturePage())

  if (image.isEmpty())
    return failed('The tab is not on screen, so it cannot be captured. eval still reads its page.')

  return {
    content: [
      { type: 'image', mimeType: 'image/jpeg', data: image.toJPEG(80).toString('base64') },
      { type: 'text', text: JSON.stringify(describe(contents)) },
    ],
  }
}
