import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

import type { PickedElement } from '../../lib/browserAnnotate'
import type { WebviewTag } from 'electron'
import type { CSSProperties, RefObject } from 'react'

/** The page size a phone watching a dock tab asked for, in CSS pixels, and the tab's conversation. */
export type WatchSize = { width: number; height: number; sessionId: string }

const watched = new Map<string, WatchSize>()
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

/** Starts or stops a phone watching a dock tab. */
export function setWatchedDockTab(tabId: string, size: WatchSize | null): void {
  if (size) watched.set(tabId, size)
  else if (!watched.delete(tabId)) return
  for (const listener of listeners) listener()
}

export function isWatchedDockTab(tabId: string): boolean {
  return watched.has(tabId)
}

/**
 * The dock tabs a phone watches in one conversation, for its sidebar row: the
 * tab's own glyph is out of sight while that dock is closed or another chat is open.
 */
export function useWatchedTabsOfSession(sessionId: string): string[] {
  const ids = useSyncExternalStore(subscribe, () => watchedTabsOf(sessionId).join('\n'))

  return ids ? ids.split('\n') : []
}

/** The dock tabs a phone watches in one conversation. */
export function watchedTabsOf(sessionId: string): string[] {
  return [...watched].flatMap(([tabId, watch]) => (watch.sessionId === sessionId ? [tabId] : []))
}

export function useWatchedDockTab(tabId: string): WatchSize | undefined {
  return useSyncExternalStore(subscribe, () => watched.get(tabId))
}

/**
 * A webview paints only while it is laid out on screen: `display: none` (an
 * inactive dock tab), a closed dock's zero width, or a position off screen all
 * stop its frames. Laid out at the phone's size and fully transparent, it keeps
 * painting, and the webview never moves in the DOM, so its page is not reloaded.
 */
export function watchedPaneStyle(size: Pick<CSSProperties, 'width' | 'height'>): CSSProperties {
  return {
    position: 'fixed',
    left: 0,
    top: 0,
    width: size.width,
    height: size.height,
    opacity: 0,
    pointerEvents: 'none',
  }
}

/**
 * The page size of a tab an agent opened with `local_browser`, whatever the dock's
 * size: the pane shows it scaled to fit, so a narrow dock never turns the page
 * into its mobile layout.
 */
export const AGENT_VIEWPORT = { width: 1440, height: 900 }

/** Tabs an agent's `local_browser open` created in this run; the main process drives only those. */
const agentTabs = new Set<string>()

export function markAgentTab(tabId: string): void {
  agentTabs.add(tabId)
}

export function isAgentTab(tabId: string): boolean {
  return agentTabs.has(tabId)
}

/**
 * A dock tab's page host: an agent's page keeps {@link AGENT_VIEWPORT} and is
 * scaled to fit the host as it resizes; any other page fills it. `place` maps a
 * page rect to where the host shows it.
 */
export function useAgentFit(tabId: string, viewRef: RefObject<WebviewTag | null>) {
  const agent = isAgentTab(tabId)
  const hostRef = useRef<HTMLDivElement>(null)
  /** Also read by a view created later, so it starts at the current scale. */
  const scaleRef = useRef(1)
  const [scale, setScale] = useState(1)
  const { width, height } = AGENT_VIEWPORT

  useEffect(() => {
    const host = hostRef.current

    if (!agent || !host) return
    const observer = new ResizeObserver(() => {
      scaleRef.current = Math.min(host.clientWidth / width, host.clientHeight / height)
      if (viewRef.current) viewRef.current.style.transform = `scale(${String(scaleRef.current)})`
      setScale(scaleRef.current)
    })

    observer.observe(host)

    return () => {
      observer.disconnect()
    }
  }, [agent, height, viewRef, width])

  const viewStyle = useCallback(
    () =>
      agent
        ? `width:${String(width)}px;height:${String(height)}px;display:flex;transform-origin:0 0;transform:scale(${String(scaleRef.current)})`
        : 'width:100%;height:100%;display:flex',
    [agent, height, width],
  )
  const place = (rect: PickedElement['rect']): PickedElement['rect'] => ({
    x: rect.x * scale,
    y: rect.y * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  })

  return { hostRef, hostClass: agent ? 'h-full overflow-hidden' : 'h-full', viewStyle, place }
}

/**
 * A tab pane's class and style: shown, hidden, or, while a phone watches it or
 * an agent drives it off screen on the Mac (inactive, or its dock closed), laid
 * out invisibly so it keeps painting. An agent's tab takes the window's size,
 * so its scaled page stays inside the window, where it is painted in full.
 */
export function paneLayout(
  active: boolean,
  dockVisible: boolean,
  watched: WatchSize | undefined,
  agent = false,
): { className: string; style?: CSSProperties } {
  const offScreen = watched ?? (agent ? { width: '100vw', height: '100vh' } : undefined)

  if (offScreen && !(active && dockVisible))
    return { className: 'flex flex-col', style: watchedPaneStyle(offScreen) }

  return { className: active ? 'h-full min-w-0 flex flex-col relative' : 'hidden' }
}

/** Each dock tab's webview once its guest is attached, so the main process can find it. */
const views = new Map<string, WebviewTag>()
const waiting = new Map<string, Set<(id: number) => void>>()

/** Called on the view's dom-ready: its guest exists from then on. */
export function registerBrowserView(tabId: string, view: WebviewTag): () => void {
  views.set(tabId, view)
  for (const resolve of waiting.get(tabId) ?? []) resolve(view.getWebContentsId())
  waiting.delete(tabId)

  return () => {
    if (views.get(tabId) === view) views.delete(tabId)
  }
}

/** The webContents id of a dock tab's page, once it is attached; null if it is not within `ms`. */
export function browserViewId(tabId: string, ms: number): Promise<number | null> {
  const view = views.get(tabId)

  if (view) return Promise.resolve(view.getWebContentsId())

  return new Promise((resolve) => {
    const done = (id: number | null) => {
      clearTimeout(timer)
      waiting.get(tabId)?.delete(done)
      resolve(id)
    }
    const timer = setTimeout(() => done(null), ms)

    waiting.set(tabId, (waiting.get(tabId) ?? new Set()).add(done))
  })
}
