// What a person does in the app that most scenarios repeat.
import { until } from './processes.ts'

import type { Stack } from './stack.ts'
import type { Locator, Page } from 'playwright-core'

export type Scenario = {
  name: string
  run: (page: Page, stack: Stack) => Promise<void>
  /** A backend failure this scenario alone is known to cause. */
  expected?: RegExp
}

/** Types into the conversation composer and sends. */
export async function send(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Message' }).click()
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
}

/** Moves the open conversation to `label`'s Claude Code runtime. */
export async function pickAgent(page: Page, label: string, provider = 'Claude Code') {
  await noMenuOpen(page)
  await page.getByRole('button', { name: /^Runtime:/ }).click()
  await pickInRow(page, label, new RegExp(`^${label}.*${provider}`))
}

/** Temporary, until #3862 is fixed: waits until no menu is mounted, a closing one included,
 *  since opening the runtime list while the model menu still closes can freeze the window. */
export async function noMenuOpen(page: Page) {
  await page.locator('[role="menu"]').first().waitFor({ state: 'detached' })
}

/** Opens the submenu the open menu's `row` holds, and gives back its list. The row opens on
 *  hover, so Base UI ignores a press on it and only a key opens it; the list is portalled
 *  away from the menu, and `aria-controls` on the row is what names it. */
export async function openSubmenu(page: Page, row: string) {
  const trigger = page.getByRole('menu').getByRole('menuitem').filter({ hasText: row }).first()

  await pickInSubmenu(page, trigger)
  // The open row and the id are not set together: the id waits for the list to exist.
  await trigger.and(page.locator('[aria-controls]')).waitFor()

  return page.locator(`#${String(await trigger.getAttribute('aria-controls'))}`)
}

/** Takes a runtime out of the open menu: `row` names the submenu to open and `item` the entry
 *  in it. The entry is looked for in that submenu alone, so a row of the menu behind it, or a
 *  submenu left open elsewhere, cannot be taken by mistake. */
export async function pickInRow(page: Page, row: string, item: RegExp) {
  const rows = await openSubmenu(page, row)

  await pickInSubmenu(page, rows.getByRole('menuitem', { name: item }).last())
}

/** Activates `item` in an open menu by key: a pointer that jumps onto a submenu lands on the
 *  row's hover guard and closes it. Waits for the menu's own word that the item can be taken,
 *  since a runtime is disabled while its conversation still streams. */
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
  await page.locator(`[data-summary-toggle][aria-expanded="${String(open)}"]`).waitFor()
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
