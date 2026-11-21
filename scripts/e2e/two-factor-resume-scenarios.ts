// Turning two-factor authentication on from an old session asks for a fresh sign-in (#4264).
// After that sign-in, Desktop goes back to the two-factor section instead of its home screen.
import { must } from './binding-access-scenarios.ts'
import { artifacts, until } from './processes.ts'
import { Authenticator, REFUSALS, signIn, signedInAgo } from './step-up-scenarios.ts'

import type { Scenario } from './ui.ts'

export const twoFactorResumeScenarios: Scenario[] = [
  {
    name: 'signing in again to turn on two-factor goes back to it, and it turns on',
    expected: REFUSALS,
    run: async (page, stack) => {
      // A session of its own, to turn it off again at the end.
      const as = await signIn(stack, stack.email)

      signedInAgo(stack.mongoUri, stack.email, 11)
      await page
        .getByRole('button', { name: /^Search/ })
        .first()
        .click()
      await page.keyboard.type('User settings')
      await page.getByRole('option', { name: 'User settings' }).first().click()
      await page.getByRole('button', { name: 'Two-factor authentication' }).click()
      await page.getByRole('button', { name: 'Turn on' }).click()
      const again = page.getByRole('button', { name: 'Sign out and sign in again' })

      await again.waitFor()
      await page.screenshot({ path: `${artifacts}/two-factor-sign-in-again.png` })
      const before = stack.signInCode(stack.email)

      await again.click()
      await page.locator('input[type=email]').fill(stack.email)
      await page.getByRole('button', { name: 'Continue with email' }).click()
      await until('a new sign-in code', async () => {
        const code = stack.signInCode(stack.email)

        return code !== undefined && code !== before
      })
      await page.locator('input[placeholder="000000"]').fill(stack.signInCode(stack.email) ?? '')
      // Back on the section it signed out from, not on the home screen.
      await page
        .getByText('Ask for a code from an authenticator app each time you sign in')
        .waitFor()
      await page.screenshot({ path: `${artifacts}/two-factor-after-sign-in.png` })

      await page.getByRole('button', { name: 'Turn on' }).click()
      const key = page.getByText(/^[A-Z2-7]{4}( [A-Z2-7]{1,4})+$/)

      await key.waitFor()
      const authenticator = new Authenticator((await key.innerText()).replaceAll(' ', ''))

      await page.locator('input[placeholder="000000"]').fill(await authenticator.code())
      await page.getByRole('button', { name: 'I saved them' }).click()
      await page.getByText('On', { exact: true }).waitFor()
      await page.screenshot({ path: `${artifacts}/two-factor-on.png` })
      await page.getByText('Back to app', { exact: true }).click()
      // Off again, for any scenario after this one.
      const off = await as('POST', '/auth/mfa/disable', { code: await authenticator.code() })

      must(off.status === 204, `two-factor authentication off, got ${off.text}`)
    },
  },
]
