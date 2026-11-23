// What a person does in the app that most scenarios repeat.
import { until } from './processes.ts'

import type { Desktop } from './desktop.ts'
import type { Stack } from './stack.ts'
import type { Locator, Page } from 'playwright-core'

export type Scenario = {
  name: string
  /** `desktop` is given by the main suite (run.ts) alone. */
  run: (page: Page, stack: Stack, desktop?: Desktop) => Promise<void>
  /** A backend failure this scenario alone is known to cause. */
  expected?: RegExp
}

/** A post in the open chat's transcript. A sidebar row can preview the same words. */
export const transcriptPost = (page: Page, text: string) =>
  page.getByRole('paragraph').filter({ hasText: new RegExp(`^${text}$`) })

/** Types into the conversation composer and sends. */
export async function send(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Message' }).click()
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
}

/** Moves the open conversation to `label`'s Claude Code runtime. */
export async function pickAgent(page: Page, label: string, provider = 'Claude Code') {
  await page.getByRole('button', { name: /^Runtime:/ }).click()
  await pickInRow(page, label, new RegExp(`^${label}.*${provider}`))
}

/** Hovers a computer's row, then takes the runtime by key without pressing its action chips. */
export async function pickInRow(page: Page, row: string, item: RegExp) {
  // Offline rows have no submenu until their computer comes back.
  const trigger = page
    .getByRole('menu')
    .getByRole('menuitem')
    .filter({ hasText: row })
    .and(page.locator('[aria-haspopup="menu"]'))
    .first()

  await trigger.hover()
  const runtime = page
    .locator('[role="menu"][data-nested][data-open]')
    .getByRole('menuitem', { name: item })
    .last()
    .and(page.locator(':not([data-disabled]):not([aria-disabled="true"])'))

  await runtime.waitFor({ timeout: 60_000 })
  await runtime.focus()
  await page.keyboard.press('Enter')
}

/** Activates `item` in an open menu by key: a pointer that jumps onto a submenu lands on the
 *  row's hover guard and closes it. Waits for the menu's own word that the item can be taken,
 *  since a runtime is disabled while a move is in flight. */
export async function pickInSubmenu(page: Page, item: Locator) {
  await until(
    'the menu item to take a key',
    async () => (await item.getAttribute('data-disabled')) === null,
  )
  await item.focus()
  await page.keyboard.press('Enter')
}

/** The Bot chat's name button, which opens and closes the Bot's details. */
export function botDetailsToggle(page: Page) {
  return page.getByRole('button', { name: 'Bot details', exact: true })
}

/** Opens or closes the Bot chat's details, whichever they are now. */
export async function setBotDetails(page: Page, open: boolean) {
  const toggle = botDetailsToggle(page)

  if ((await toggle.getAttribute('aria-expanded')) !== String(open)) await toggle.click()
  await page.locator(`[data-summary-toggle][aria-expanded="${String(open)}"]:visible`).waitFor()
}

/** The runtime or model control: a Bot chat's is a row of its details, a Task's a composer chip. */
export async function settingButton(page: Page, name: RegExp) {
  if (!(await botDetailsToggle(page).isVisible())) return page.getByRole('button', { name })
  await setBotDetails(page, true)

  return page.getByRole('complementary', { name: 'Bot details' }).getByRole('button', { name })
}

/** In a narrow pane the panel floats under the name, start-aligned with it, as the Task summary floats. */
export async function checkBotDetailsFloating(page: Page) {
  // It scales in from the name; measure where it lands.
  await page.waitForTimeout(500)
  const toggle = await botDetailsToggle(page).boundingBox()
  const panel = await page.getByRole('complementary', { name: 'Bot details' }).boundingBox()

  if (!toggle || !panel) throw new Error('The name or the floating details are not on screen')
  if (Math.abs(panel.x - toggle.x) > 1 || panel.y < toggle.y + toggle.height)
    throw new Error(
      `The details float at ${JSON.stringify(panel)}, not under ${JSON.stringify(toggle)}`,
    )
}

/** Opens the Bot's Task from its chat's details. Close them on the way back to the chat. */
export async function openBotTask(page: Page) {
  await setBotDetails(page, true)
  await page
    .getByRole('complementary', { name: 'Bot details' })
    .getByRole('button', { name: 'Task', exact: true })
    .click()
}

export async function newTask(page: Page) {
  await page.getByRole('tab', { name: 'Tasks' }).click()
  await page.getByRole('button', { name: 'New task', exact: true }).click()
}

/** The team's Computers page, through ⌘K. */
export async function openComputers(page: Page) {
  await page
    .getByRole('button', { name: /^Search/ })
    .first()
    .click()
  await page.keyboard.type('Computers')
  await page.getByRole('option', { name: 'Computers' }).first().click()
}
