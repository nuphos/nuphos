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
  /** Frames where text sampled across the chat pane was fainter than once the switch settled. */
  washFrames: number
  /** The faintest of those texts, its opacity and the text, to say what washed out. */
  washedText: string | null
  /** Frames with `typedFrom` on screen but not `typedTo`: a reply being typed out. */
  typedFrames: number
  /** Frames with a composer chip (access mode, model) on screen reading other than once settled. */
  chipFrames: number
  /** The first such chip and what it read, to say what changed. */
  chipText: string | null
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

  // The faintest text across the chat pane, its title bar included, sampled down to the composer.
  const paneOpacity = () => {
    const left = (document.querySelector('aside')?.getBoundingClientRect().right ?? 0) + 24
    let faintest = { opacity: 1, text: '' }

    for (let col = 0; col < 6; col++)
      for (let row = 0; row < 7; row++) {
        const x = left + ((innerWidth - 24 - left) * (col + 0.5)) / 6
        // Row 0 runs through the title bar.
        const y = row === 0 ? 30 : 80 + ((innerHeight - 220) * (row - 0.5)) / 6
        const element = document.elementFromPoint(x, y)

        if (!element?.textContent?.trim() || element.closest('aside')) continue
        let opacity = 1

        for (let node: Element | null = element; node; node = node.parentElement)
          opacity *= Number(getComputedStyle(node).opacity)
        // Hidden text (a message's time, shown on hover) is not on screen; a fade passes above 0.
        if (opacity > 0 && opacity < faintest.opacity)
          faintest = { opacity, text: element.textContent.trim().slice(0, 60) }
      }

    return faintest
  }

  // What each composer chip reads, or null when it is not on screen. The
  // runtime chip is read by where it starts, so a late chip beside it can't push it.
  const CHIPS = {
    access: '[aria-label="Authorization mode"]',
    model: '[data-model-chip]',
    'runtime x': '[aria-label^="Runtime: "]',
  }
  const chipTexts = () =>
    Object.fromEntries(
      Object.entries(CHIPS).map(([chip, selector]) => {
        const shown = [...document.querySelectorAll(selector)].find((element) =>
          element.checkVisibility({ visibilityProperty: true }),
        )
        const read =
          chip === 'runtime x'
            ? String(Math.round(shown?.getBoundingClientRect().left ?? 0))
            : // What it shows: a chip keeps its other labels in it, unseen, to hold its width.
              ((shown as HTMLElement | undefined)?.innerText ?? '').trim()

        return [chip, shown ? read : null]
      }),
    )

  // A chip may appear late, but must read as it settles from its first frame on.
  const chipChanges = (chips: Record<string, string | null>[]) => {
    const final = chips.at(-1) ?? {}
    const changed = (read: Record<string, string | null>) =>
      Object.keys(final).find((chip) => read[chip] != null && read[chip] !== final[chip])
    const wrong = chips.filter((read) => changed(read))
    const first = wrong[0]
    const chip = first && changed(first)

    return {
      chipFrames: wrong.length,
      chipText: chip
        ? `${chip} read "${String(first[chip])}", then "${String(final[chip])}"`
        : null,
    }
  }

  return new Promise((resolve) => {
    let clicked: number | null = null
    let settledAt: number | null = null
    // Each frame's faintest pane text; text meant to be faint is as faint in the last frame.
    const panes: { opacity: number; text: string }[] = []
    const chips: Record<string, string | null>[] = []
    let frames = 0
    const result: SwitchWatch = {
      clickedAt: 0,
      shownAt: null,
      framesToContent: null,
      fadeFrames: 0,
      washFrames: 0,
      washedText: null,
      typedFrames: 0,
      chipFrames: 0,
      chipText: null,
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
        panes.push(paneOpacity())
        chips.push(chipTexts())
        if (result.framesToContent === null && shown >= 0.95) {
          result.framesToContent = frames
          result.shownAt = performance.timeOrigin + now
        }
        if (typedFrom && typedTo && seen(typedFrom) > 0 && seen(typedTo) === 0) result.typedFrames++
        if (result.newestAfterMs === null && seen(newest ?? history) >= 0.95)
          result.newestAfterMs = Math.round(now - clicked)
        // On for half a second more, for a fade that starts once the chat is there.
        if (result.newestAfterMs !== null && result.framesToContent !== null) settledAt ??= now
        if ((settledAt !== null && now - settledAt > 500) || now - clicked > timeoutMs) {
          const settled = panes.at(-1)?.opacity ?? 1
          const washed = panes.filter((faintest) => faintest.opacity < settled - 0.05)
          const worst = washed.reduce<(typeof washed)[number] | null>(
            (a, b) => (a && a.opacity <= b.opacity ? a : b),
            null,
          )

          result.washFrames = washed.length
          result.washedText = worst && `${worst.opacity.toFixed(2)} "${worst.text}"`
          Object.assign(result, chipChanges(chips))
          resolve(result)

          return
        }
      }
      requestAnimationFrame(frame)
    }

    requestAnimationFrame(frame)
  })
}
