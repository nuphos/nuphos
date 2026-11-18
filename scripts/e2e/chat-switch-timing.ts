// Watches one switch to a chat in the window, frame by frame from the click on its sidebar
// row, for what can be asserted without timing anything.
import type { Locator, Page } from 'playwright-core'

export type SwitchWatch = {
  /** Epoch ms of the click and of the first frame with the chat's history on screen. */
  clickedAt: number
  shownAt: number | null
  /** Frames after the click up to and including the first with the history; 1 is the first frame. */
  framesToContent: number | null
  /** Frames with the history in the page but faded (between 5 % and 95 % opacity). */
  fadeFrames: number
  /** Frames with `typedFrom` on screen but not `typedTo`: a reply being typed out. */
  typedFrames: number
  /** ms from the click to the first frame with `newest` on screen. */
  newestAfterMs: number | null
}

type Texts = { history: string; newest?: string; typedFrom?: string; typedTo?: string }

/** Clicks `row` and watches until `newest` (or the history) is on screen, or `timeoutMs`. */
export async function watchSwitch(page: Page, row: Locator, texts: Texts, timeoutMs = 15_000) {
  await row.waitFor()
  const watching = page.evaluate(watch, { ...texts, timeoutMs })

  // The watcher arms on the next frame; the click must come after it.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))
  await row.click()

  return watching
}

// Runs in the window, so it must be self-contained.
function watch({
  history,
  newest,
  typedFrom,
  typedTo,
  timeoutMs,
}: Texts & { timeoutMs: number }): Promise<SwitchWatch> {
  // The text's effective opacity where it is on screen outside the sidebar, or 0.
  const seen = (text: string) => {
    const found = document.evaluate(
      `//text()[contains(., ${JSON.stringify(text)})]`,
      document.body,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null,
    )
    let best = 0

    for (let n = 0; n < found.snapshotLength; n++) {
      const element = found.snapshotItem(n)?.parentElement

      if (!element || element.closest('[data-sidebar-row], aside')) continue
      if (!element.checkVisibility({ visibilityProperty: true })) continue
      const box = element.getBoundingClientRect()

      if (box.bottom <= 0 || box.top >= innerHeight || box.width === 0) continue
      let opacity = 1

      for (let node: Element | null = element; node; node = node.parentElement)
        opacity *= Number(getComputedStyle(node).opacity)
      best = Math.max(best, opacity)
    }

    return best
  }

  return new Promise((resolve) => {
    let clicked: number | null = null
    let frames = 0
    const result: SwitchWatch = {
      clickedAt: 0,
      shownAt: null,
      framesToContent: null,
      fadeFrames: 0,
      typedFrames: 0,
      newestAfterMs: null,
    }

    addEventListener(
      'click',
      (event) => {
        clicked = event.timeStamp
        result.clickedAt = performance.timeOrigin + event.timeStamp
      },
      { capture: true, once: true },
    )
    const frame = (now: number) => {
      if (clicked !== null) {
        frames++
        const shown = seen(history)

        if (shown > 0.05 && shown < 0.95) result.fadeFrames++
        if (result.framesToContent === null && shown >= 0.95) {
          result.framesToContent = frames
          result.shownAt = performance.timeOrigin + now
        }
        if (typedFrom && typedTo && seen(typedFrom) > 0 && seen(typedTo) === 0) result.typedFrames++
        if (result.newestAfterMs === null && seen(newest ?? history) >= 0.95)
          result.newestAfterMs = Math.round(now - clicked)
        if (
          (result.newestAfterMs !== null && result.framesToContent !== null) ||
          now - clicked > timeoutMs
        ) {
          resolve(result)

          return
        }
      }
      requestAnimationFrame(frame)
    }

    requestAnimationFrame(frame)
  })
}
