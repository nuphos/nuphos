// What a chat switch does to what floats over a chat: its details panel, floating in a narrow
// pane, and a menu left open. A chat opened before stays in the page, hidden (#4430), and what
// it put at the page's root must hide and show with it.
import { kept } from './chat-keep.ts'
import { artifacts, until } from './processes.ts'

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
  try {
    await until(
      'one details panel on screen',
      async () => (await visiblePanels(page)) === 1,
      10_000,
    )
  } catch (error) {
    await page.screenshot({ path: `${artifacts}/details-${mark}.png` })
    const seen = await panels(page).evaluateAll((all) =>
      all.map((panel) => ({
        visible: panel.checkVisibility(),
        display: panel.style.display,
        mark: panel.dataset.e2eMark,
        root: panel.parentElement === document.body,
      })),
    )

    throw new Error(`details panels for ${mark}: ${JSON.stringify(seen)}`, { cause: error })
  }
  await panels(page)
    .filter({ visible: true })
    .evaluate((panel, value) => {
      if (getComputedStyle(panel).position !== 'fixed') throw new Error('the panel does not float')
      panel.dataset.e2eMark = value
    }, mark)
}

const visiblePanels = (page: Page) => panels(page).filter({ visible: true }).count()

/** Toggles the details by key, from no field: a composer could take Ctrl+I for itself. */
async function toggleDetails(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press(DETAILS)
}

function note(line: string, failure?: string) {
  overlayLines.push(failure ? `- **Failed**: ${line}: ${failure}` : `- ${line}`)
  if (failure) overlayFailed.push(`${line}: ${failure}`)
}

/** Narrow, the details float at the page's root: a hidden chat's never shows over another, and
 *  a chat switched to starts with its panel closed. */
async function floatingDetails(page: Page, a: Chat, b: Chat) {
  const cdp = await page.context().newCDPSession(page)
  // Checked once the chat shows, without waiting: a panel left over it would show for frames.
  const closed = async () => (await visiblePanels(page)) === 0

  try {
    await cdp.send('Emulation.setDeviceMetricsOverride', NARROW)
    await openRow(page, b)
    await openRow(page, a)
    await toggleDetails(page)
    await markPanel(page, 'a')
    // By key: the pointer stays put, so nothing presses outside the popover.
    await page.keyboard.press(BACK)
    await until(`${b.title} on screen`, async () => (await onScreen(page, b)) > 0, 10_000)
    const toB = await closed()

    note(
      `floating details open in ${a.title}, Back to ${b.title}: no panel on screen ${String(toB)}`,
      toB ? undefined : `a panel shows over ${b.title}`,
    )
    await toggleDetails(page)
    await markPanel(page, 'b')
    await page.keyboard.press(FORWARD)
    await until(`${a.title} on screen`, async () => (await onScreen(page, a)) > 0, 10_000)
    const toA = await closed()

    note(
      `floating details open in ${b.title}, Forward to ${a.title}: no panel on screen ${String(toA)}`,
      toA ? undefined : `a panel shows over ${a.title}`,
    )
  } finally {
    await cdp.send('Emulation.clearDeviceMetricsOverride')
    await cdp.detach()
  }
}

/** A menu open in a chat: Back leaves no menu over the next chat, and the chat is as it was left
 *  on the way back. Only by key: the menu makes the rest of the page inert, so a press on the
 *  sidebar closes it first. */
async function openMenu(page: Page, a: Chat, b: Chat) {
  await openRow(page, b)
  await openRow(page, a)
  await page
    .getByRole('button', { name: /^Runtime:/ })
    .filter({ visible: true })
    .click()
  await until('the menu open', async () => (await visibleMenus(page)) > 0, 10_000)
  await page.keyboard.press(BACK)
  const switched = await until(
    `${b.title} on screen`,
    async () => (await onScreen(page, b)) > 0,
    5_000,
  ).then(
    () => true,
    () => false,
  )
  const menus = await visibleMenus(page)

  note(
    `menu open in ${a.title}, Back key: switched ${String(switched)}, ${String(menus)} menus on screen`,
    !switched
      ? `the Back key did not open ${b.title}`
      : menus > 0
        ? `the menu stayed over ${b.title}`
        : undefined,
  )
  // A failure is recorded above; end with the menu closed and A left for B either way.
  if (menus > 0) {
    await page.keyboard.press('Escape')
    await until('the menu closed', async () => (await visibleMenus(page)) === 0, 10_000)
  }
  if (!switched) await openRow(page, b)
  await openRow(page, a)
  const back = await visibleMenus(page)

  note(
    `menu open in ${a.title}, back to it: ${String(back)} menus on screen`,
    back > 0 ? 'the menu came back open' : undefined,
  )
  await kept(page, `menu open in ${a.title}, back to it`, a.title, a.text)
}

export async function overlayScenarios(page: Page, a: Chat, b: Chat) {
  await floatingDetails(page, a, b)
  await openMenu(page, a, b)
}
