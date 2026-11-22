// What a chat switch does to what floats over a chat: its details panel, floating in a narrow
// pane, and a menu left open. A chat opened before stays in the page, hidden (#4430), and what
// it put at the page's root must hide and show with it.
import { kept } from './chat-keep.ts'
import { until } from './processes.ts'

import type { Page } from 'playwright-core'

/** `text`: a line its transcript shows. */
type Chat = { tab: 'Tasks' | 'Bots'; title: string; text: string }

const NARROW = { width: 820, height: 760, deviceScaleFactor: 0, mobile: false }
// Back and Forward off macOS, the same history as the sidebar's buttons.
const BACK = 'Alt+ArrowLeft'
const FORWARD = 'Alt+ArrowRight'
// A narrow pane hides the details button; the shortcut still opens and closes them.
const DETAILS = 'Control+KeyI'

/** What failed, and one line per step for the report. */
export const overlayFailed: string[] = []
export const overlayLines: string[] = []

const panels = (page: Page) =>
  page.getByRole('complementary', { name: 'Task summary', exact: true })
const visibleMenus = (page: Page) => page.getByRole('menu').filter({ visible: true }).count()
const onScreen = (page: Page, chat: Chat) =>
  page.getByText(chat.text).filter({ visible: true }).count()

async function openRow(page: Page, chat: Chat) {
  await page.getByRole('tab', { name: chat.tab }).click()
  await page
    .getByRole('tabpanel', { name: chat.tab })
    .locator('[data-sidebar-row]')
    .filter({ hasText: chat.title })
    .first()
    .click()
  await until(`${chat.title} on screen`, async () => (await onScreen(page, chat)) > 0, 10_000)
}

/** Marks the details panel on screen as `mark`, to know it again by its element. */
async function markPanel(page: Page, mark: string) {
  await until('one details panel on screen', async () => (await visiblePanels(page)) === 1, 10_000)
  await panels(page)
    .filter({ visible: true })
    .evaluate((panel, value) => {
      if (getComputedStyle(panel).position !== 'fixed') throw new Error('the panel does not float')
      panel.dataset.e2eMark = value
    }, mark)
}

const visiblePanels = (page: Page) => panels(page).filter({ visible: true }).count()

/** Presses `key`; frames and ms until the element marked `mark` is on screen, or null. */
async function pressUntilShown(page: Page, key: string, mark: string) {
  await page.evaluate((value) => {
    const started = performance.now()
    let frames = 0

    ;(window as unknown as { e2eShown: Promise<unknown> }).e2eShown = new Promise((resolve) => {
      const tick = () => {
        frames++
        const element = document.querySelector<HTMLElement>(`[data-e2e-mark="${value}"]`)

        if (element?.checkVisibility())
          resolve({ frames, ms: Math.round(performance.now() - started) })
        else if (frames > 300) resolve(null)
        else requestAnimationFrame(tick)
      }

      requestAnimationFrame(tick)
    })
  }, mark)
  await page.keyboard.press(key)

  return page.evaluate(
    () =>
      (window as unknown as { e2eShown: Promise<{ frames: number; ms: number } | null> }).e2eShown,
  )
}

/** Toggles the details by key, from no field: a composer could take Ctrl+I for itself. */
async function toggleDetails(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press(DETAILS)
}

function note(line: string, failure?: string) {
  overlayLines.push(failure ? `- **Failed**: ${line}: ${failure}` : `- ${line}`)
  if (failure) overlayFailed.push(`${line}: ${failure}`)
}

/** Narrow, the details float at the page's root: each chat's hides with it and shows with it. */
async function floatingDetails(page: Page, a: Chat, b: Chat) {
  const cdp = await page.context().newCDPSession(page)

  try {
    await cdp.send('Emulation.setDeviceMetricsOverride', NARROW)
    await openRow(page, a)
    await openRow(page, b)
    await toggleDetails(page)
    await markPanel(page, 'b')
    // Back to A by key: the pointer stays put, so nothing presses outside the popover.
    await page.keyboard.press(BACK)
    await until(`${a.title} on screen`, async () => (await onScreen(page, a)) > 0, 10_000)
    const bHidden = !(await page.locator('[data-e2e-mark="b"]').isVisible())

    await markPanel(page, 'a')
    note(
      `floating details, ${b.title} → ${a.title}: ${b.title}'s panel hidden ${String(bHidden)}, one panel on screen`,
      bHidden ? undefined : `${b.title}'s panel still shows over ${a.title}`,
    )
    const shown = await pressUntilShown(page, FORWARD, 'b')
    const aHidden = !(await page.locator('[data-e2e-mark="a"]').isVisible())
    const count = await visiblePanels(page)

    const when = shown
      ? `on frame ${String(shown.frames)}, ${String(shown.ms)} ms after the key`
      : 'never'

    let failure: string | undefined

    if (!shown) failure = 'its panel never showed again'
    else if (!aHidden || count !== 1) failure = `${String(count)} panels on screen`
    note(
      `floating details, back to ${b.title}: its own panel shown again ${when}, ${a.title}'s hidden ${String(aHidden)}, ${String(count)} on screen`,
      failure,
    )
    await toggleDetails(page)
    await until('the panel closed', async () => (await visiblePanels(page)) === 0, 10_000)
  } finally {
    await cdp.send('Emulation.clearDeviceMetricsOverride')
    await cdp.detach()
  }
}

/** A menu open in a chat: switching away leaves no menu over the next chat, and the chat is
 *  as it was left on the way back. By key, then by the sidebar. */
async function openMenu(page: Page, a: Chat, b: Chat, by: 'key' | 'row') {
  await openRow(page, b)
  await openRow(page, a)
  await page
    .getByRole('button', { name: /^Runtime:/ })
    .filter({ visible: true })
    .click()
  await until('the menu open', async () => (await visibleMenus(page)) > 0, 10_000)
  if (by === 'key') await page.keyboard.press(BACK)
  else
    await page
      .getByRole('tabpanel', { name: b.tab })
      .locator('[data-sidebar-row]')
      .filter({ hasText: b.title })
      .first()
      .click()
  await page.waitForTimeout(500)
  const switched = (await onScreen(page, b)) > 0
  const menus = await visibleMenus(page)

  const press = by === 'key' ? 'Back key' : `${b.title}'s row`

  note(
    `menu open in ${a.title}, ${press}: switched ${String(switched)}, ${String(menus)} menus on screen`,
    switched && menus > 0 ? `the menu stayed over ${b.title}` : undefined,
  )
  // Whatever the press did, end with the menu closed and A left for B.
  if (!switched) {
    await page.keyboard.press('Escape')
    await until('the menu closed', async () => (await visibleMenus(page)) === 0, 10_000)
    await openRow(page, b)
  }
  await openRow(page, a)
  const back = await visibleMenus(page)

  note(
    `menu open in ${a.title}, back to it: ${String(back)} menus on screen`,
    back > 0 ? 'the menu came back open' : undefined,
  )
  await kept(page, `menu open in ${a.title} (${by}), back to it`, a.title, a.text)
}

export async function overlayScenarios(page: Page, a: Chat, b: Chat) {
  await floatingDetails(page, a, b)
  await openMenu(page, a, b, 'key')
  await openMenu(page, a, b, 'row')
}
