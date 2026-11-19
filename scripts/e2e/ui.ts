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
export async function pickAgent(page: Page, label: string) {
  await page.getByRole('button', { name: /^Runtime:/ }).click()
  // The computer's row opens a submenu of its runtimes.
  await page.getByRole('menu').getByText(label).click()
  await pickInSubmenu(
    page,
    page.getByRole('menuitem', { name: new RegExp(`^${label}.*Claude Code`) }),
  )
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
