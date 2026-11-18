// Times one switch to a chat, frame by frame in the window, from the press on its sidebar row:
// when the chat's history shows, when its newest message shows, and how many frames a
// spinner or a fade had the chat area show nothing readable meanwhile.
import type { Locator, Page } from 'playwright-core'

export type SwitchSample = {
  /** ms from the press to the first frame the history text is on screen, fully opaque. */
  history: number | null
  /** ms to the first frame the newest text is on screen; history's when there is none. */
  latest: number | null
  /** Frames, after the press and before the history, with the opening spinner on screen. */
  spinnerFrames: number
}

type Watch = { history: string; latest?: string; timeoutMs: number }

/** Clicks `row` and watches for `history`, then `latest`, outside the sidebar. */
export async function timeSwitch(
  page: Page,
  row: Locator,
  texts: { history: string; latest?: string },
  timeoutMs = 15_000,
): Promise<SwitchSample> {
  await row.waitFor()
  const watching = page.evaluate(watchSwitch, { ...texts, timeoutMs })

  // The watcher arms on the next frame; the press must come after it.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))
  await row.click()

  return watching
}

// Runs in the window, so it must be self-contained.
function watchSwitch({ history, latest, timeoutMs }: Watch): Promise<SwitchSample> {
  const opacity = (element: Element | null) => {
    let value = 1

    for (let node = element; node; node = node.parentElement)
      value *= Number(getComputedStyle(node).opacity)

    return value
  }
  const shown = (text: string) => {
    const found = document.evaluate(
      `//text()[contains(., ${JSON.stringify(text)})]`,
      document.body,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null,
    )

    for (let n = 0; n < found.snapshotLength; n++) {
      const element = found.snapshotItem(n)?.parentElement

      if (!element || element.closest('[data-sidebar-row], nav, aside')) continue
      if (!element.checkVisibility({ visibilityProperty: true })) continue
      const box = element.getBoundingClientRect()

      if (box.bottom <= 0 || box.top >= innerHeight || box.width === 0) continue
      if (opacity(element) >= 0.95) return true
    }

    return false
  }
  const spinner = () =>
    [...document.querySelectorAll('[aria-busy="true"]')].some((element) =>
      element.checkVisibility(),
    )

  return new Promise((resolve) => {
    let start: number | null = null
    const sample: SwitchSample = { history: null, latest: null, spinnerFrames: 0 }
    const press = () => {
      start = performance.now()
    }

    addEventListener('pointerdown', press, { capture: true, once: true })
    const frame = (now: number) => {
      if (start !== null) {
        const elapsed = Math.round(now - start)

        if (sample.history === null && spinner()) sample.spinnerFrames++
        if (sample.history === null && shown(history)) sample.history = elapsed
        if (sample.history !== null && sample.latest === null && shown(latest ?? history))
          sample.latest = elapsed
        if (sample.latest !== null || elapsed > timeoutMs) {
          resolve(sample)

          return
        }
      }
      requestAnimationFrame(frame)
    }

    requestAnimationFrame(frame)
  })
}
