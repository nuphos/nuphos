// #4270: a Bot's Tasks belong to its owner, so a teammate the Bot is shared with never lists
// them. The Bot's own row says how many run or wait, for the owner and that teammate alike.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { startDesktop } from './desktop.ts'
import { artifacts, until } from './processes.ts'
import { send } from './ui.ts'

import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

type Row = { sessionId: string; title?: string; tasks?: { running: number; waiting: number } }

export const botSharedTaskCountScenarios: Scenario[] = [
  {
    name: 'a Bot’s row counts its running Task for its owner and for a teammate it is shared with',
    run: async (page, stack) => {
      const call = async (token: string, method: string, path: string, body?: object) => {
        const response = await fetch(`${stack.apiUrl}${path}`, {
          method,
          headers: {
            ...(token && { authorization: `Bearer ${token}` }),
            'content-type': 'application/json',
          },
          body: body && JSON.stringify(body),
        })

        if (!response.ok) throw new Error(`${method} ${path} answered ${String(response.status)}`)

        return (await response.json().catch(() => ({}))) as Record<string, unknown>
      }
      const bot = async (token: string, scope: string) =>
        (
          ((
            await call(
              token,
              'GET',
              `/agent/conversations?teamId=${stack.teamId}&scope=${scope}&bots=true&limit=30`,
            )
          ).conversations ?? []) as Row[]
        ).find((row) => row.title === 'E2E Bot')
      const release = join(artifacts, 'release')
      const email = `e2e-shared-bot-${String(Date.now())}@example.com`

      await call('', 'POST', '/auth/email/request-code', { email })
      await until('the teammate’s sign-in code', async () => stack.signInCode(email))
      const teammate = String(
        (
          await call('', 'POST', '/auth/email/verify-code', {
            email,
            code: stack.signInCode(email),
          })
        ).token,
      )
      const invited = await call(stack.token, 'POST', `/teams/${stack.teamId}/invitations`, {
        inviteeEmail: email,
      })

      await call(
        teammate,
        'POST',
        `/invitations/${String((invited.invitation as { id: string }).id)}/accept`,
      )
      const members = ((await call(stack.token, 'GET', `/teams/${stack.teamId}/members`)).members ??
        []) as { id: string; email: string }[]
      const teammateId = String(members.find((member) => member.email === email)?.id)
      const owned = await bot(stack.token, 'mine')

      if (!owned) throw new Error('The owner does not list E2E Bot')
      await call(
        stack.token,
        'POST',
        `/agent/conversations/${owned.sessionId}/participants?teamId=${stack.teamId}`,
        { userIds: [teammateId] },
      )

      await page.getByRole('tab', { name: 'Bots' }).click()
      await page
        .getByRole('tabpanel', { name: 'Bots' })
        .locator('[data-sidebar-row]')
        .filter({ hasText: 'E2E Bot' })
        .first()
        .click()
      rmSync(release, { force: true })
      try {
        await send(page, 'Hand this off E2E_SUBTASK E2E_DELIVERY:unlisted-shared-count')
        for (const [who, token, scope] of [
          ['owner', stack.token, 'mine'],
          ['teammate', teammate, 'shared'],
        ] as const)
          await until(`the ${who} to read one running Task on E2E Bot`, async () => {
            const row = await bot(token, scope)

            return row?.tasks?.running === 1 ? row : undefined
          })
        await shoot(page, 'owner', /Waiting on 1 Task: E2E unlisted kid/)
        // The teammate's own app, signed in as them: the count, and no Task's name.
        const signIn = join(artifacts, 'sign-in-teammate')

        mkdirSync(signIn, { recursive: true })
        writeFileSync(
          join(signIn, 'desktop.yaml'),
          `api: ${stack.apiUrl}\ntoken: ${teammate}\nuserInfo:\n  id: ${teammateId}\n`,
          { mode: 0o600 },
        )
        const theirs = await startDesktop(stack.apiUrl, { name: 'teammate' })

        try {
          await theirs.page.getByRole('tab', { name: 'Bots' }).click()
          await theirs.page
            .getByRole('tabpanel', { name: 'Bots' })
            .locator('[data-sidebar-row]')
            .filter({ hasText: 'E2E Bot' })
            .first()
            .click()
          await shoot(theirs.page, 'teammate', /Waiting on 1 Task(?!:)/)
          if ((await theirs.page.getByText('E2E unlisted kid').count()) > 0)
            throw new Error('The teammate sees the Task’s name')
        } finally {
          await theirs.stop()
        }
      } finally {
        writeFileSync(release, '')
      }
      await until('the Task to finish for the teammate too', async () => {
        const row = await bot(teammate, 'shared')

        return row?.tasks?.running === 0 ? row : undefined
      })
      // The teammate leaves, so the scenarios after this one see the team as before.
      await call(stack.token, 'DELETE', `/teams/${stack.teamId}/members/${teammateId}`)
      rmSync(release, { force: true })
    },
  },
]

/** The visible chat's status pill reads `text`; a light-theme capture for the PR. */
async function shoot(page: Page, who: string, text: RegExp) {
  await page.getByText(text).locator('visible=true').first().waitFor({ timeout: 30_000 })
  await page.evaluate(() => {
    document.documentElement.classList.remove('dark')
    document.documentElement.classList.add('light')
  })
  await page.screenshot({ path: join(artifacts, `shared-bot-${who}-light.png`) })
}
