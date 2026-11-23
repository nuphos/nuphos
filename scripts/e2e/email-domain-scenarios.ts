// #4012: an admin signed in with a public email address (gmail.com) cannot turn on discovery by
// email domain, so the Allowed email domains row disables its switch and says why. An admin on a
// company domain (the stack's own example.com account) still gets the switch.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { client, must } from './binding-access-scenarios.ts'
import { startDesktop } from './desktop.ts'
import { artifacts, until } from './processes.ts'

import type { Client } from './binding-access-scenarios.ts'
import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

const PUBLIC_REASON =
  "gmail.com is a public email provider, so it can't be used. Sign in with a company email to turn this on."

/** Signs a gmail.com address in with an email code and makes it an admin of the stack's team. */
async function joinWithGmail(stack: Stack, owner: Client) {
  const email = `e2e-public-${String(Date.now())}@gmail.com`
  const anonymous = client(stack.apiUrl, '')

  await anonymous('POST', '/auth/email/request-code', { email })
  await until('the gmail.com sign-in code to be logged', async () => stack.signInCode(email))
  const verified = await anonymous('POST', '/auth/email/verify-code', {
    email,
    code: stack.signInCode(email),
  })
  const token = (verified.body as { token: string }).token
  const member = client(stack.apiUrl, token)
  const invited = await owner('POST', `/teams/${stack.teamId}/invitations`, { inviteeEmail: email })
  const invitationId = (invited.body as { invitation: { id: string } }).invitation.id

  must(
    (await member('POST', `/invitations/${invitationId}/accept`)).status === 200,
    'the gmail.com member to accept the invitation',
  )
  const me = (await member('GET', '/auth/me')).body as { user?: { id: string }; id?: string }
  const id = me.user?.id ?? me.id ?? ''
  const promoted = await owner('PATCH', `/teams/${stack.teamId}/members/${id}`, {
    role: 'ADMINISTRATOR',
  })

  must(
    promoted.status === 200,
    `the gmail.com member to become an admin, got ${String(promoted.status)}`,
  )

  return { member, token, id }
}

/** What the team JSON says of the viewer's email domain. */
async function viewerDomainPublic(stack: Stack, as: Client) {
  const team = (await as('GET', `/teams/${stack.teamId}`)).body as {
    viewerEmailDomainPublic?: boolean
  }

  return team.viewerEmailDomainPublic
}

/** Team settings › General, through ⌘K, scrolled to the Allowed email domains row. */
async function openAllowedDomains(page: Page) {
  await page
    .getByRole('button', { name: /^Search/ })
    .first()
    .click()
  await page.keyboard.type('Team settings')
  await page.getByRole('option', { name: 'Team settings' }).first().click()
  const heading = page.getByRole('heading', { name: 'Allowed email domains' })

  await heading.scrollIntoViewIfNeeded()

  return page.getByRole('switch', { name: 'Enable domain discovery' })
}

/** A light capture of the row, the theme put back after. */
async function capture(page: Page, name: string) {
  const theme = await page.evaluate(() => document.documentElement.className)

  await page.evaluate(() => {
    document.documentElement.classList.remove('dark')
    document.documentElement.classList.add('light')
  })
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(artifacts, `email-domain-${name}-light.png`) })
  await page.evaluate((previous) => {
    document.documentElement.className = previous
  }, theme)
}

export const emailDomainScenarios: Scenario[] = [
  {
    name: 'an admin on gmail.com cannot turn on Allowed email domains and reads why; one on a company domain can',
    run: async (page, stack) => {
      const owner = client(stack.apiUrl, stack.token)

      must((await viewerDomainPublic(stack, owner)) === false, 'example.com to be no public domain')
      const company = await openAllowedDomains(page)

      await page.getByText('Your email domain, taken from your account.', { exact: true }).waitFor()
      must(await company.isEnabled(), 'the company-domain admin to have the switch enabled')
      await capture(page, 'company-admin')
      await page.getByRole('button', { name: 'Back to app' }).click()

      const gmail = await joinWithGmail(stack, owner)

      must((await viewerDomainPublic(stack, gmail.member)) === true, 'gmail.com to be public')
      const signIn = join(artifacts, 'sign-in-gmail-admin')

      mkdirSync(signIn, { recursive: true })
      writeFileSync(
        join(signIn, 'desktop.yaml'),
        `api: ${stack.apiUrl}\ntoken: ${gmail.token}\nuserInfo:\n  id: ${gmail.id}\n`,
        { mode: 0o600 },
      )
      const theirs = await startDesktop(stack.apiUrl, { name: 'gmail-admin' })

      try {
        const disabled = await openAllowedDomains(theirs.page)

        await theirs.page.getByText(PUBLIC_REASON, { exact: true }).waitFor()
        must(await disabled.isDisabled(), 'the gmail.com admin to have the switch disabled')
        await capture(theirs.page, 'gmail-admin')
      } finally {
        await theirs.stop()
      }
      // The gmail.com admin leaves the team, so the scenarios after this one see it as before.
      const left = await owner('DELETE', `/teams/${stack.teamId}/members/${gmail.id}`)

      must(left.status < 300, `the gmail.com admin to leave the team, got ${String(left.status)}`)
    },
  },
]
