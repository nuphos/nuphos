// A group chat with a teammate's Bot, set up by that teammate through the API and read in the app.
import { joinTeam } from './dashboard-scenarios.ts'
import { artifacts } from './processes.ts'

import type { Scenario } from './ui.ts'

export const teammateBotScenarios: Scenario[] = [
  {
    // #3243: a teammate's Bot posted with its runtime mark, as the viewer's lists never held its face.
    name: "a teammate's Bot posts in a group chat with its own face",
    run: async (page, stack) => {
      const teammate = await joinTeam(stack, 'teammate')
      const third = await joinTeam(stack, 'third')
      const call = async <T>(token: string, path: string, body: unknown): Promise<T> => {
        const response = await fetch(`${stack.apiUrl}${path}`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ teamId: stack.teamId, ...(body as object) }),
        })

        if (!response.ok)
          throw new Error(`${path} answered ${String(response.status)}: ${await response.text()}`)

        return (await response.json().catch(() => ({}))) as T
      }
      const me = (await (
        await fetch(`${stack.apiUrl}/auth/me`, {
          headers: { authorization: `Bearer ${stack.token}` },
        })
      ).json()) as { id: string }
      const bot = await call<{ sessionId: string }>(teammate.token, '/agent/bots', {
        title: 'Scribe',
        avatar: '07-ada',
      })
      const chat = await call<{ sessionId: string }>(teammate.token, '/agent/channels', {
        title: 'Scribe room',
        group: true,
      })

      await call(teammate.token, `/agent/conversations/${chat.sessionId}/participants`, {
        userIds: [me.id, third.id],
      })
      await call(teammate.token, `/agent/conversations/${chat.sessionId}/agents`, {
        sessionId: bot.sessionId,
      })
      await call(teammate.token, `/agent/conversations/${chat.sessionId}/channel-messages`, {
        text: 'Minutes, please E2E_DELIVERY:teammate-bot',
      })
      await call(stack.token, `/agent/conversations/${chat.sessionId}/channel-messages`, {
        text: 'My own message E2E_BUBBLE:own',
      })
      await page.getByRole('tab', { name: 'Bots' }).click()
      const row = page.locator('aside [data-sidebar-row]', { hasText: 'Scribe room' }).first()

      // #3428: the cluster's rings are cut out, so they match the row at rest, hovered and selected.
      await row.locator('[data-chat-face]').nth(2).waitFor({ timeout: 30_000 })
      await page.mouse.move(700, 450)
      await page.waitForTimeout(400)
      await row.screenshot({ path: `${artifacts}/group-row-rest.png` })
      await row.hover()
      await page.waitForTimeout(400)
      await row.screenshot({ path: `${artifacts}/group-row-hover.png` })
      await row.click()
      const post = page.locator('.group\\/post', {
        has: page.getByText('POSTED E2E_DELIVERY:teammate-bot', { exact: true }),
      })

      await post.waitFor({ timeout: 60_000 })
      // #4189: compare the viewer, the human teammate, and the Bot in the real Desktop.
      const teammatePost = page.locator('.group\\/post', {
        has: page.getByText('Minutes, please E2E_DELIVERY:teammate-bot', { exact: true }),
      })
      const ownPost = page.locator('.group\\/post', {
        has: page.getByText('My own message E2E_BUBBLE:own', { exact: true }),
      })
      await teammatePost.waitFor()
      await ownPost.waitFor()
      const botFill = await post.locator('.bg-state-selected').count()
      const teammateFill = await teammatePost.locator('.bg-state-selected').count()
      const ownFill = await ownPost.locator('.bg-state-selected').count()
      await page.screenshot({ path: `${artifacts}/group-chat-bubbles-4189.png` })
      if (botFill !== 1 || teammateFill !== 1 || ownFill !== 0)
        throw new Error(`Bubble fills: bot=${botFill}, teammate=${teammateFill}, own=${ownFill}`)
      // The face, not only the runtime mark.
      await post.locator('img[src*="bot-avatars/07-ada"]').first().waitFor({ timeout: 10_000 })
      // #3428: its sidebar row wears the design system's cluster of three: the Bot, then both teammates.
      const discs = await row
        .locator('[data-chat-face]')
        .evaluateAll((faces) => faces.map((face) => face.getBoundingClientRect().width))

      if (discs.join() !== '24,18,14')
        throw new Error(`The group's sidebar faces are ${discs.join()}`)
      await page.mouse.move(700, 450)
      await page.waitForTimeout(400)
      await row.screenshot({ path: `${artifacts}/group-row-selected.png` })
      await page.screenshot({ path: `${artifacts}/teammate-bot-post.png` })
      // #3298: a teammate's Bot's permission mode and model are its owner's to change.
      const offered = await page
        .getByRole('button', { name: /^(Authorization mode|Model settings)/ })
        .count()

      if (offered > 0) throw new Error(`A teammate's Bot offers ${String(offered)} of its settings`)
    },
  },
]
