import { app, BrowserWindow } from 'electron'

import { extensionHost } from '../browser-extensions/host.ts'
import { browserSession } from '../browser-extensions/manage.ts'
import { raiseWindow } from '../../window-raise.ts'

import { startRecording, stopRecording } from './browser-recording.ts'
import { failed } from './cua-host.ts'
import { closeDockTab, dockMirrorOf, focusDockTab, openDockTab } from './dock-mirror.ts'
import { proxyFetch } from './dock-proxy.ts'

import type { BrowserCall } from './browser-stream.ts'
import type { CuaToolResult } from './cua-host.ts'
import type { WebContents } from 'electron'

/** How long a page may take to load before a call returns it as it is. */
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

/**
 * The page size of an agent's tab, whatever the user's screen or dock: sites lay
 * out for a desktop, and the page is captured in full.
 */
const VIEWPORT = { width: 1440, height: 900 }

/**
 * Each tab an agent's `open` created, with its conversation, so one
 * conversation never drives another's; and its window, hidden unless the user
 * is shown it (`show`). The page is the window's own: a hidden window paints it
 * for a capture, where a view inside one has nothing to capture.
 */
const tabs = new Map<WebContents, { conversation: string; window: BrowserWindow }>()

let quitting = false

app.on('before-quit', () => {
  quitting = true
})

/** The browser tabs this conversation opened. */
function browserTabs(conversation: string): WebContents[] {
  return [...tabs].flatMap(([contents, tab]) =>
    tab.conversation === conversation ? [contents] : [],
  )
}

/** A hidden window on the user's browser session, so its pages keep the user's sign-ins. */
function openTab(url: string, conversation: string): WebContents {
  const window = new BrowserWindow({
    ...VIEWPORT,
    useContentSize: true,
    enableLargerThanScreen: true,
    resizable: false,
    show: false,
    webPreferences: {
      session: browserSession(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  const contents = window.webContents

  tabs.set(contents, { conversation, window })
  extensionHost()?.extensions.addTab(contents, window)
  // Closing a shown tab hides it again, as the conversation still drives it.
  window.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    window.hide()
  })
  window.on('closed', () => tabs.delete(contents))
  contents.loadURL(url).catch(() => {
    // A failed load leaves the tab on its error page, which `describe` reports.
  })

  return contents
}

/** Ends every agent tab, for when the app's last window closes where that quits it. */
export function closeBrowserTabs(): void {
  for (const { window } of tabs.values()) window.destroy()
}

/** `work` on a tab whose page keeps painting meanwhile, though its window is hidden. */
async function unthrottled<T>(contents: WebContents, work: () => Promise<T>): Promise<T> {
  const throttled = contents.getBackgroundThrottling()

  contents.setBackgroundThrottling(false)
  try {
    return await work()
  } finally {
    if (!contents.isDestroyed()) contents.setBackgroundThrottling(throttled)
  }
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

/** Runs one `local_browser` action against the workspace's browser tabs. */
export async function runBrowserCall(call: BrowserCall): Promise<CuaToolResult> {
  // Without a conversation, tabs nobody opened (the app's own renderer included) would match.
  if (!call.session) return failed('session is required.')
  if (call.action === 'tabs') return text(browserTabs(call.session).map(describe))
  if (call.action === 'dock') return dockMirrorOf(call)
  if (call.action === 'focus') return focusDockTab(call)
  // The iPhone closes a dock tab by its workspace id; an agent closes its own tab.
  if (call.action === 'close' && call.dockTab !== undefined) return closeDockTab(call)
  if (call.action === 'dock_open') return openDockTab(call)
  if (call.action === 'fetch') return proxyFetch(call)
  if (call.action === 'open') {
    if (!isHttp(call.url)) return failed('url must be an http(s) URL.')
    const contents = openTab(call.url, call.session)

    await loaded(contents)

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
  const window = tabs.get(contents)?.window

  if (call.action === 'show') {
    raiseWindow(window)

    return text(`Tab ${String(contents.id)} is on screen; closing its window hides it again.`)
  }
  if (call.action === 'close') {
    window?.destroy()

    return text(`Closed tab ${String(contents.id)}.`)
  }
  if (call.action === 'record_start') {
    // A recorded page keeps running at full speed until record_stop.
    contents.setBackgroundThrottling(false)
    await startRecording(contents)

    return text(`Recording tab ${String(contents.id)}. Use the page, then call record_stop.`)
  }
  if (call.action === 'record_stop') {
    contents.setBackgroundThrottling(true)

    return text(await stopRecording(contents))
  }
  const image = await unthrottled(contents, () => onPage(contents, contents.capturePage()))

  if (image.isEmpty())
    return failed('The tab painted nothing to capture. eval still reads its page.')

  return {
    content: [
      { type: 'image', mimeType: 'image/jpeg', data: image.toJPEG(80).toString('base64') },
      { type: 'text', text: JSON.stringify(describe(contents)) },
    ],
  }
}
