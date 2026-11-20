// Signing in to a fresh Desktop, the first thing every run does.
import { artifacts } from './processes.ts'

import type { Scenario } from './ui.ts'

const BAD_ADDRESS = "That email address doesn't look right. Check it and try again."

export const signInScenarios: Scenario[] = [
  {
    name: 'a mistyped address is refused with a plain sentence',
    run: async (page) => {
      // The toast and its screen-reader announcement both carry the sentence.
      const sentence = page.getByText(BAD_ADDRESS).first()
      // Error toasts are aria-hidden until focused, so by label rather than role.
      const dismiss = page.getByLabel('Dismiss')

      await page.evaluate(() => localStorage.setItem('nuphos.locale', 'en'))
      await page.reload()
      // The form lets this through; the backend refuses it.
      await page.locator('input[type=email]').fill('e2e..typo@example.com')
      await page.getByRole('button', { name: 'Continue with email' }).click()
      await sentence.waitFor()
      // Settled, so the shot is not mid-animation. Error toasts stay until dismissed.
      await dismiss.hover({ trial: true })
      await page.screenshot({ path: `${artifacts}/sign-in-invalid-email.png` })
      await dismiss.click()
      await sentence.waitFor({ state: 'hidden' })
      await page.getByRole('button', { name: 'Continue with email' }).waitFor()
    },
  },
  {
    name: 'sign in with an email code and land in the team',
    run: async (page, stack) => {
      await page.locator('input[type=email]').fill(stack.email)
      await page.getByRole('button', { name: 'Continue with email' }).click()
      await page.getByText('Enter the 6-digit code').waitFor()
      // Entering the sixth digit submits the form.
      await page.locator('input[placeholder="000000"]').fill(stack.signInCode(stack.email) ?? '')
      await page.getByRole('tab', { name: 'Tasks' }).waitFor({ timeout: 60_000 })
    },
  },
]
