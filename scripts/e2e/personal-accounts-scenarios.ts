// #4410: a member's several GitHub accounts each get a line and a Disconnect of their own in Connectors.
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
        await page.getByRole('button', { name: 'Connectors', exact: true }).click()
        await page
          .getByRole('dialog', { name: 'Connectors', exact: true })
          .getByRole('button', { name: 'Open GitHub', exact: true })
          .first()
          .click()
        // The member's accounts are listed on the service's own page.
        const connectors = page.getByRole('dialog', { name: 'GitHub', exact: true })

        await connectors.getByText(`Connected as ${WORK}`).waitFor()
        await connectors.getByText(`Connected as ${HOME}`).waitFor()
        await connectors.getByRole('button', { name: 'Connect another account' }).first().waitFor()
        await shoot(page, 'personal-accounts-two')

        await connectors.getByRole('button', { name: `Disconnect ${HOME}` }).click()
        const dialog = page.getByRole('alertdialog')

        await dialog.getByText(HOME).first().waitFor()
        await shoot(page, 'personal-accounts-confirm')
        await dialog.getByRole('button', { name: 'Disconnect', exact: true }).click()

        await until('only the named account to be gone', async () => logins() === `["${WORK}"]`)
        await connectors.getByText(`Connected as ${HOME}`).waitFor({ state: 'detached' })
        await connectors.getByText(`Connected as ${WORK}`).waitFor()
        await shoot(page, 'personal-accounts-one')
        assert.equal(logins(), `["${WORK}"]`)
        await connectors.getByLabel('Close modal').click()
        await connectors.waitFor({ state: 'detached' })
      } finally {
        inDatabase(
          stack,
          `await db.collection('personal_credentials').deleteMany({ userId: process.argv[2], provider: 'github' })`,
          userId,
        )
      }
    },
  },
  {
    // The team has no Google OAuth client: its admin can open Team settings, a member is told whom to ask.
    name: 'a Google account waiting for the team OAuth client sends an admin to Team settings and a member to the admin',
    run: async (page, stack) => {
      const anonymous = client(stack.apiUrl, '')
      const email = `ada-admin-${String(Date.now())}@example.com`

      await anonymous('POST', '/auth/email/request-code', { email })
      await until('the sign-in code to be logged', async () => stack.signInCode(email))
      const signedIn = await anonymous('POST', '/auth/email/verify-code', {
        email,
        code: stack.signInCode(email),
      })
      const admin = client(stack.apiUrl, String((signedIn.body as { token?: string }).token))
      const made = await admin('POST', '/teams', { name: 'Ada Studio' })
      const teamId = String((made.body as { team?: { id: string } }).team?.id)
      const invited = await admin('POST', `/teams/${teamId}/invitations`, {
        inviteeEmail: stack.email,
      })

      await client(stack.apiUrl, stack.token)(
        'POST',
        `/invitations/${String((invited.body as { invitation?: { id: string } }).invitation?.id)}/accept`,
      )

      // A Google account still waiting for the client opens Gmail's own page, which says why.
      const connectors = page.getByRole('dialog', { name: 'Gmail', exact: true })
      const hint = connectors.getByText(/Needs a Google OAuth client/).first()
      const open = async () => {
        await page.getByRole('button', { name: 'Connectors', exact: true }).click()
        await page
          .getByRole('dialog', { name: 'Connectors', exact: true })
          .getByRole('button', { name: 'Add Gmail', exact: true })
          .first()
          .click()
        await hint.waitFor()
      }
      const close = async () => {
        await connectors.getByLabel('Close modal').click()
        await connectors.waitFor({ state: 'detached' })
      }
      const switchTo = async (from: RegExp, name: string) => {
        await page.getByText(from).first().click()
        await page.getByRole('menuitem', { name: 'Switch workspace' }).click()
        await page.getByRole('menuitem', { name: new RegExp(`${name}$`) }).click()
      }

      // The app's own person made the E2E team, so is its admin.
      await open()
      await connectors.getByRole('button', { name: 'Open Team settings' }).first().waitFor()
      await shoot(page, 'personal-google-admin')
      await close()

      await switchTo(/^E2E$/, 'Ada Studio')
      await open()
      await connectors
        .getByText(/Ask .+ to add one in Team settings/)
        .first()
        .waitFor()
      assert.equal(await connectors.getByRole('button', { name: 'Open Team settings' }).count(), 0)
      await shoot(page, 'personal-google-member')
      await close()
      await switchTo(/^Ada Studio$/, 'E2E')
    },
  },
]
