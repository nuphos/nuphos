// What a person does in the app that most scenarios repeat.
import { artifacts } from './processes.ts'

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

/** A typo the sign-in form lets through gets the backend's plain sentence, not a retry hint. */
export async function mistypeEmail(page: Page) {
  const sentence = page.getByText("That email address doesn't look right. Check it and try again.")
  // Error toasts are aria-hidden until focused, so by label rather than role.
  const dismiss = page.getByLabel('Dismiss')

  await page.locator('input[type=email]').fill('e2e..typo@example.com')
  await page.getByRole('button', { name: 'Continue with email' }).click()
  // The toast and its screen-reader announcement both carry it.
  await sentence.first().waitFor()
  // Settled, so the shot is not mid-animation; error toasts stay until dismissed.
  await dismiss.hover({ trial: true })
  await page.screenshot({ path: `${artifacts}/sign-in-invalid-email.png` })
  await dismiss.click()
  await sentence.first().waitFor({ state: 'hidden' })
}
