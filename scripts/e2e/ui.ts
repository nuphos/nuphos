// What a person does in the app that most scenarios repeat.
import type { Stack } from './stack.ts'
import type { Page } from 'playwright-core'

export type Scenario = { name: string; run: (page: Page, stack: Stack) => Promise<void> }

/** Types into the conversation composer and sends. */
export async function send(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Message' }).click()
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
}

export async function newTask(page: Page) {
  await page.getByRole('tab', { name: 'Tasks' }).click()
  await page.getByRole('button', { name: 'New task', exact: true }).click()
}
