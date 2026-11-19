// `local_browser` under `nuphos agent`, with no Desktop: each tab is a page of a headless
// Chromium on the computer, driven over its debugging pipe, so no debugging port is opened.

import { join } from 'node:path'

import { startRecording, stopRecording } from './browser-recording.ts'
import { LocalBrowserStream } from './browser-stream.ts'
import { Cdp, helperPage, launchChromium } from './cli-chromium.ts'
import { failed } from './cua-host.ts'

import type { RecordedTab } from './browser-recording.ts'
import type { BrowserCall } from './browser-stream.ts'
import type { Browser, Listener } from './cli-chromium.ts'
import type { CuaToolResult } from './cua-host.ts'

type Tab = RecordedTab & {
  conversation: string
  targetId: string
  sessionId: string
  loading: boolean
  stopped: Set<() => void>
}

// As on Desktop (browser-tabs.ts).
const LOAD_TIMEOUT_MS = 20_000
const CALL_TIMEOUT_MS = 30_000
const VIEWPORT = { width: 1440, height: 900 }
/** The actions on one of the conversation's tabs; the rest need a Desktop's screen and dock. */
const TAB_ACTIONS = new Set([
  'navigate',
  'eval',
  'screenshot',
  'close',
  'record_start',
  'record_stop',
])
const NO_SCREEN =
  'This computer runs Nuphos without a screen, so its tabs cannot be shown; take a screenshot instead.'

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

/** Fails `work` once `ms` pass, as a page that never answers would otherwise hang the call. */
function within<T>(work: Promise<T>, ms = CALL_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`The call did not finish within ${String(ms / 1000)}s.`)),
      ms,
    )

    work.finally(() => clearTimeout(timer)).then(resolve, reject)
  })
}

/** Runs `local_browser` calls on one browser, started on the first and again after it exits. */
export function createCliBrowser(launch: () => Browser, harDir: string) {
  let connection: Cdp | undefined
  const tabs = new Map<number, Tab>()
  let lastTab = 0

  const onEvent: Listener = (method, params, sessionId) => {
    const tab = [...tabs.values()].find((t) => t.sessionId === (params.sessionId ?? sessionId))

    if (!tab) return
    if (method === 'Target.detachedFromTarget') tabs.delete(tab.id)
    if (params.frameId !== tab.targetId) return
    if (method === 'Page.frameStartedLoading') tab.loading = true
    if (method === 'Page.frameStoppedLoading') {
      tab.loading = false
      for (const resolve of tab.stopped) resolve()
      tab.stopped.clear()
    }
  }
  const connect = (): Cdp => {
    if (connection) return connection
    const browser = launch()
    const cdp = new Cdp(browser)

    cdp.listeners.add(onEvent)
    void browser.exited.then(() => {
      if (connection === cdp) connection = undefined
      tabs.clear()
      cdp.end()
    })
    connection = cdp

    return cdp
  }
  /** Resolves once the page stops loading, or after the timeout either way. */
  const loaded = (tab: Tab) =>
    tab.loading
      ? new Promise<void>((resolve) => {
          tab.stopped.add(resolve)
          setTimeout(resolve, LOAD_TIMEOUT_MS)
        })
      : Promise.resolve()
  const go = async (cdp: Cdp, tab: Tab, url: string) => {
    tab.loading = true
    const { errorText } = await cdp.send<{ errorText?: string }>(
      'Page.navigate',
      { url },
      tab.sessionId,
    )

    // A failed load leaves the tab on its error page, which `describe` reports.
    if (errorText) tab.loading = false
    await loaded(tab)
  }
  const describe = async (cdp: Cdp, tab: Tab) => {
    const { targetInfo } = await cdp.send<{ targetInfo: { url: string; title: string } }>(
      'Target.getTargetInfo',
      { targetId: tab.targetId },
    )

    return { tab: tab.id, url: targetInfo.url, title: targetInfo.title, loading: tab.loading }
  }
  const open = async (cdp: Cdp, conversation: string, url: string) => {
    const { targetId } = await cdp.send<{ targetId: string }>('Target.createTarget', {
      url: 'about:blank',
    })
    const { sessionId } = await cdp.send<{ sessionId: string }>('Target.attachToTarget', {
      targetId,
      flatten: true,
    })
    const tab: Tab = {
      id: ++lastTab,
      conversation,
      targetId,
      sessionId,
      loading: false,
      stopped: new Set(),
      debugger: recorder(cdp, sessionId),
    }

    tabs.set(tab.id, tab)
    await cdp.send('Page.enable', {}, sessionId)
    await cdp.send(
      'Emulation.setDeviceMetricsOverride',
      { ...VIEWPORT, deviceScaleFactor: 1, mobile: false },
      sessionId,
    )
    await go(cdp, tab, url)

    return tab
  }

  return async function run(call: BrowserCall): Promise<CuaToolResult> {
    if (!call.session) return failed('session is required.')
    const mine = [...tabs.values()].filter((t) => t.conversation === call.session)

    if (call.action === 'tabs')
      return text(await Promise.all(mine.map((t) => describe(connect(), t))))
    if (call.action === 'open') {
      if (!isHttp(call.url)) return failed('url must be an http(s) URL.')
      const cdp = connect()

      return text(await describe(cdp, await open(cdp, call.session, call.url)))
    }
    if (!TAB_ACTIONS.has(call.action)) return failed(NO_SCREEN)
    const cdp = connect()
    const tab = mine.find((t) => t.id === call.tab)

    if (!tab)
      return failed(
        `Tab ${String(call.tab)} is not one this conversation opened; list its tabs with action "tabs".`,
      )
    if (call.action === 'navigate') {
      if (!isHttp(call.url)) return failed('url must be an http(s) URL.')
      await within(go(cdp, tab, call.url), LOAD_TIMEOUT_MS).catch(() => {})

      return text(await describe(cdp, tab))
    }
    if (call.action === 'eval') {
      if (!call.script) return failed('script is required.')
      const { result, exceptionDetails } = await within(
        cdp.send<{
          result: { value?: unknown }
          exceptionDetails?: { text: string; exception?: { description?: string } }
        }>(
          'Runtime.evaluate',
          { expression: call.script, awaitPromise: true, returnByValue: true, userGesture: true },
          tab.sessionId,
        ),
      )

      if (exceptionDetails)
        throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
      await loaded(tab)

      return text(result.value === undefined ? 'undefined' : result.value)
    }
    if (call.action === 'close') {
      await cdp.send('Target.closeTarget', { targetId: tab.targetId })
      tabs.delete(tab.id)

      return text(`Closed tab ${String(tab.id)}.`)
    }
    if (call.action === 'record_start') {
      await startRecording(tab, call.video ? () => helperPage(cdp) : undefined)

      return text(`Recording tab ${String(tab.id)}. Use the page, then call record_stop.`)
    }
    if (call.action === 'record_stop')
      return text(
        await stopRecording(tab, {
          dir: harDir,
          creator: { name: 'Nuphos CLI', version: process.env.NUPHOS_CLI_VERSION ?? 'dev' },
        }),
      )
    const { data } = await within(
      cdp.send<{ data: string }>(
        'Page.captureScreenshot',
        { format: 'jpeg', quality: 80 },
        tab.sessionId,
      ),
    )

    return {
      content: [
        { type: 'image', mimeType: 'image/jpeg', data },
        { type: 'text', text: JSON.stringify(await describe(cdp, tab)) },
      ],
    }
  }
}

/** A page's side of the shared HAR recorder (browser-recording.ts), over its debugging session. */
function recorder(cdp: Cdp, sessionId: string): RecordedTab['debugger'] {
  type OnMessage = Parameters<RecordedTab['debugger']['on']>[1]
  const forwards = new Map<OnMessage, Listener>()

  return {
    attach: () => {},
    // Recording ends with the page's network events off again.
    detach: () => void cdp.send('Network.disable', {}, sessionId).catch(() => {}),
    isAttached: () => true,
    sendCommand: (method, params) => cdp.send(method, params, sessionId),
    on: (_event, listener) => {
      const forward: Listener = (method, params, from) => {
        if (from === sessionId) listener({}, method, params)
      }

      forwards.set(listener, forward)
      cdp.listeners.add(forward)
    },
    off: (_event, listener) => {
      cdp.listeners.delete(forwards.get(listener)!)
      forwards.delete(listener)
    },
  }
}

/** The CLI host's `local_browser`, offered only when the computer has a Chromium to run it on. */
export function cliBrowser(dataDir: string, executable: string | undefined) {
  if (!executable) return {}
  const run = createCliBrowser(
    () => launchChromium(executable, join(dataDir, 'browser')),
    join(dataDir, 'har'),
  )

  return { connectBrowser: () => new LocalBrowserStream(run) }
}
