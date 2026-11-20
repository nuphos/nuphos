// What a person does in the app that most scenarios repeat.
import type { Stack } from './stack.ts'
import type { Page } from 'playwright-core'

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
  await pickInSubmenu(page, label, new RegExp(`^${label}.*${provider}`))
}

/** Temporary, until #3862 is fixed: waits until no menu is mounted, a closing one included,
 *  since opening the runtime list while the model menu still closes can freeze the window. */
export async function noMenuOpen(page: Page) {
  await page.locator('[role="menu"]').first().waitFor({ state: 'detached' })
}

/** Opens the submenu the open menu's `row` holds and picks `item` in it, by key throughout: a
 *  press on a row whose submenu opens on hover is ignored, a pointer landing on the submenu
 *  closes it, and `aria-controls` names the portalled list `item` lives in. */
export async function pickInSubmenu(page: Page, row: string | RegExp, item: RegExp) {
  const trigger = page.getByRole('menu').getByRole('menuitem').filter({ hasText: row }).first()

  await trigger.focus()
  await page.keyboard.press('Enter')
  // `aria-controls` arrives with the submenu, so wait for the row to report it open first.
  await trigger.and(page.locator('[data-popup-open]')).waitFor()
  const submenu = page.locator(`#${String(await trigger.getAttribute('aria-controls'))}`)

  await submenu.getByRole('menuitem', { name: item }).last().focus()
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
