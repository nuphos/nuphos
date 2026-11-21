// #4410: a member's several GitHub accounts each get a row and a Disconnect of their own.
import assert from 'node:assert/strict'

import { client } from './binding-access-scenarios.ts'
import { inDatabase } from './personal-credential-scenarios.ts'
import { artifacts, until } from './processes.ts'

import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

const WORK = 'ada-work@example.com'
const HOME = 'ada-home@example.com'

const light = (page: Page) =>
  page.evaluate(() => {
    document.documentElement.classList.remove('dark')
    document.documentElement.classList.add('light')
  })

async function shoot(page: Page, name: string) {
  await light(page)
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${artifacts}/${name}-light.png` })
}

export const personalAccountScenarios: Scenario[] = [
  {
    name: 'two connected GitHub accounts are listed, and Disconnect revokes only the one named',
    run: async (page, stack) => {
      const owner = client(stack.apiUrl, stack.token)
      const me = (await owner('GET', '/auth/me')).body as { user?: { id: string }; id?: string }
      const userId = me.user?.id ?? me.id ?? ''
      const logins = () =>
        inDatabase(
          stack,
          `const docs = await db.collection('personal_credentials')
            .find({ userId: process.argv[2], provider: 'github' }).toArray()
          console.log(JSON.stringify(docs.map((d) => d.login).sort()))`,
          userId,
        )

      // The GitHub consent can't run here, so each grant it would store is written directly.
      for (const login of [WORK, HOME]) {
        inDatabase(
          stack,
          `await db.collection('personal_credentials').insertOne({
            userId: process.argv[2], provider: 'github', providerUserId: process.argv[3],
            login: process.argv[3], encryptedAccessToken: null, encryptedRefreshToken: null,
            accessTokenExpiresAt: null, createdAt: new Date(), updatedAt: new Date(),
          })`,
          userId,
          login,
        )
      }

      try {
        await page
          .getByRole('button', { name: /^Search/ })
          .first()
          .click()
        await page.keyboard.type('User settings')
        await page.getByRole('option', { name: 'User settings' }).first().click()
        await page.getByRole('searchbox', { name: 'Search settings' }).fill('Personal Credentials')
        await page.keyboard.press('Enter')
        await page.getByText(`Connected as ${WORK}`).waitFor()
        await page.getByText(`Connected as ${HOME}`).waitFor()
        await page.getByRole('button', { name: 'Connect another account' }).first().waitFor()
        await shoot(page, 'personal-accounts-two')

        await page.getByRole('button', { name: `Disconnect ${HOME}` }).click()
        const dialog = page.getByRole('alertdialog')

        await dialog.getByText(HOME).first().waitFor()
        await shoot(page, 'personal-accounts-confirm')
        await dialog.getByRole('button', { name: 'Disconnect', exact: true }).click()

        await until('only the named account to be gone', async () => logins() === `["${WORK}"]`)
        await page.getByText(`Connected as ${HOME}`).waitFor({ state: 'detached' })
        await page.getByText(`Connected as ${WORK}`).waitFor()
        await shoot(page, 'personal-accounts-one')
        assert.equal(logins(), `["${WORK}"]`)
        await page.getByText('Back to app', { exact: true }).click()
      } finally {
        inDatabase(
          stack,
          `await db.collection('personal_credentials').deleteMany({ userId: process.argv[2], provider: 'github' })`,
          userId,
        )
      }
    },
  },
]
