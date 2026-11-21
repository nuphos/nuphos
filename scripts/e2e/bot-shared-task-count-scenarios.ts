// #4270: a Bot's Tasks belong to its owner, so a teammate the Bot is shared with never lists
// them. The Bot's own row counts the running ones, and the teammate's Bots row works with it.
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
    name: 'a Bot shared with a teammate works in their Bots list while its Task runs',
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
      // Shared with the teammate: they can open the Bot, never its Tasks.
      await call(
        stack.token,
        'POST',
        `/agent/conversations/${owned.sessionId}/participants?teamId=${stack.teamId}`,
        { userIds: [teammateId] },
      )
      const signIn = join(artifacts, 'sign-in-teammate')

      mkdirSync(signIn, { recursive: true })
      writeFileSync(
        join(signIn, 'desktop.yaml'),
        `api: ${stack.apiUrl}\ntoken: ${teammate}\nuserInfo:\n  id: ${teammateId}\n`,
        { mode: 0o600 },
      )
      const theirs = await startDesktop(stack.apiUrl, { name: 'teammate' })
      const botRow = (on: Page) =>
        on
          .getByRole('tabpanel', { name: 'Bots' })
          .locator('[data-sidebar-row]')
          .filter({ hasText: 'E2E Bot' })
          .first()

      try {
        await theirs.page.getByRole('tab', { name: 'Bots' }).click()
        await botRow(theirs.page).waitFor()
        await page.getByRole('tab', { name: 'Bots' }).click()
        await botRow(page).click()
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
          await busy(page, 'owner', true)
          await busy(theirs.page, 'teammate', true)
        } finally {
          writeFileSync(release, '')
        }
        await until('the Task to finish for the teammate too', async () => {
          const row = await bot(teammate, 'shared')

          return row?.tasks?.running === 0 ? row : undefined
        })
        await busy(theirs.page, 'teammate', false)
      } finally {
        await theirs.stop()
      }
      // The teammate leaves the Bot and the team, so the scenarios after this one see both as before.
      await call(
        stack.token,
        'DELETE',
        `/agent/conversations/${owned.sessionId}/participants/${teammateId}?teamId=${stack.teamId}`,
      )
      await call(stack.token, 'DELETE', `/teams/${stack.teamId}/members/${teammateId}`)
      rmSync(release, { force: true })
    },
  },
]

/** The Bots row of E2E Bot plays its working loop, or stops; a light capture either way. */
async function busy(page: Page, who: string, working: boolean) {
  const loop = page
    .getByRole('tabpanel', { name: 'Bots' })
    .locator('[data-sidebar-row]')
    .filter({ hasText: 'E2E Bot' })
    .first()
    .locator('[data-looping]')
  const shot = `shared-bot-${who}-${working ? 'working' : 'idle'}-light.png`

  await page.evaluate(() => {
    document.documentElement.classList.remove('dark')
    document.documentElement.classList.add('light')
  })
  try {
    if (working) await loop.waitFor({ timeout: 30_000 })
    else await loop.waitFor({ state: 'detached', timeout: 30_000 })
  } finally {
    await page.screenshot({ path: join(artifacts, shot) })
  }
}
