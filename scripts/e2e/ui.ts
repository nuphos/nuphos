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
  // The computer's row opens a submenu of its runtimes.
  await page.getByRole('menu').getByText(label).click()
  await pickInSubmenu(
    page,
    page.getByRole('menuitem', { name: new RegExp(`^${label}.*${provider}`) }),
  )
}

/** Temporary, until #3862 is fixed: waits until no menu is mounted, a closing one included,
 *  since opening the runtime list while the model menu still closes can freeze the window. */
export async function noMenuOpen(page: Page) {
  await page.locator('[role="menu"]').first().waitFor({ state: 'detached' })
}

/** Picks `item` in the submenu a menu row opened, by key. A pointer that jumps from the row onto
 *  the submenu can land on the row's hover guard instead, and the submenu closes under it. */
export async function pickInSubmenu(page: Page, item: Locator) {
  await item.focus()
  await page.keyboard.press('Enter')
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
