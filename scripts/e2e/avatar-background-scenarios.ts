// A Bot's background, picked in Change avatar and saved through the real backend.
import { client, must } from './binding-access-scenarios.ts'
import { artifacts, until } from './processes.ts'

import type { Scenario } from './ui.ts'

export const avatarBackgroundScenarios: Scenario[] = [
  {
    // #3504: the tint a Bot's face sits on shows wherever the face does.
    name: "a Bot's picked background shows in the sidebar, its chat and the chat's members",
    run: async (page, stack) => {
      const api = client(stack.apiUrl, stack.token)
      const created = await api('POST', '/agent/bots', {
        teamId: stack.teamId,
        title: 'Painter',
        avatar: '07-ada',
      })

      must(created.status === 201, `the Bot to be created, got ${created.text}`)
      const bot = (created.body as { sessionId: string }).sessionId
      // Its 1:1 chat, which is the Bot's row in Bots.
      const own = (await api('POST', '/agent/channels', { teamId: stack.teamId })).body as {
        sessionId: string
      }

      await api('POST', `/agent/conversations/${own.sessionId}/agents`, {
        teamId: stack.teamId,
        sessionId: bot,
      })
      const chat = (
        await api('POST', '/agent/channels', {
          teamId: stack.teamId,
          title: 'Painter room',
          group: true,
        })
      ).body as { sessionId: string }

      await api('POST', `/agent/conversations/${chat.sessionId}/agents`, {
        teamId: stack.teamId,
        sessionId: bot,
      })
      await api('POST', `/agent/conversations/${chat.sessionId}/channel-messages`, {
        teamId: stack.teamId,
        text: 'Sketch, please E2E_DELIVERY:avatar-background',
      })

      await page.getByRole('tab', { name: 'Bots' }).click()
      const row = page
        .locator('aside [data-sidebar-row]')
        .filter({ has: page.getByText('Painter', { exact: true }) })
        .first()

      await row.waitFor({ timeout: 30_000 })
      // None is today's look: no disc behind the face.
      must(
        (await row.locator('[data-avatar-background]').count()) === 0,
        'a new Bot to have no background',
      )
      await row.click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Change avatar' }).click()
      const background = page.getByRole('radiogroup', { name: 'Background' })

      await background.getByRole('radio', { name: 'Sky' }).click()
      await page.screenshot({ path: `${artifacts}/avatar-background-dialog.png` })
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      await row.locator('[data-avatar-background="sky"]').waitFor({ timeout: 10_000 })
      await row.screenshot({ path: `${artifacts}/avatar-background-sidebar.png` })

      // Saved on the server, not only shown.
      await until('the server to hold the background', async () => {
        const bots = await api('GET', `/agent/conversations?teamId=${stack.teamId}&bots=true`)
        const saved = (
          bots.body as { conversations: { sessionId: string; avatarBackground?: string }[] }
        ).conversations.find((conversation) => conversation.sessionId === bot)

        return saved?.avatarBackground === 'sky'
      })

      // In the group chat: the Bot's post and the chat's members wear it too.
      await page.locator('aside [data-sidebar-row]', { hasText: 'Painter room' }).first().click()
      const post = page.locator('.group\\/post', {
        has: page.getByText('POSTED E2E_DELIVERY:avatar-background', { exact: true }),
      })

      await post.waitFor({ timeout: 60_000 })
      await post.locator('[data-avatar-background="sky"]').first().waitFor({ timeout: 10_000 })
      // This chat's members button: the one wearing the Bot's face. Stacked faces overlap, so
      // the disc is in the button rather than fully on screen.
      const members = page
        .locator('button[title="Share with a teammate"]')
        .filter({ has: page.locator('[data-avatar-background="sky"]') })
        .first()

      await members.waitFor({ timeout: 10_000 })
      await page.screenshot({ path: `${artifacts}/avatar-background-chat.png` })
      await members.click()
      await page.screenshot({ path: `${artifacts}/avatar-background-members.png` })
      await page.keyboard.press('Escape')
    },
  },
]
