// What a person does in the app that most scenarios repeat.
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
  const runtimes = await openSubmenu(page, label)

  await pickInSubmenu(
    page,
    runtimes.getByRole('menuitem', { name: new RegExp(`^${label}.*${provider}`) }).last(),
  )
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

  await trigger.focus()
  await page.keyboard.press('Enter')
  await trigger.and(page.locator('[data-popup-open]')).waitFor()

  return page.locator(`#${String(await trigger.getAttribute('aria-controls'))}`)
}

/** Picks `item` in the submenu a menu row opened, by key. A pointer that jumps from the row onto
 *  the submenu can land on the row's hover guard instead, and the submenu closes under it. */
export async function pickInSubmenu(page: Page, item: Locator) {
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
