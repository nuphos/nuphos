import { useSyncExternalStore } from 'react'

import type { CSSProperties } from 'react'
import type { WebviewTag } from 'electron'

/** The page size a phone watching a dock tab asked for, in CSS pixels. */
export type WatchSize = { width: number; height: number }

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

export function useWatchedDockTab(tabId: string): WatchSize | undefined {
  return useSyncExternalStore(subscribe, () => watched.get(tabId))
}

/**
 * A webview paints only while it is laid out on screen: `display: none` (an
 * inactive dock tab), a closed dock's zero width, or a position off screen all
 * stop its frames. Laid out at the phone's size and fully transparent, it keeps
 * painting, and the webview never moves in the DOM, so its page is not reloaded.
 */
export function watchedPaneStyle(size: WatchSize): CSSProperties {
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
