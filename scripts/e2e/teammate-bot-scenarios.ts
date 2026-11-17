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
        userIds: [me.id],
      })
      await call(teammate.token, `/agent/conversations/${chat.sessionId}/agents`, {
        sessionId: bot.sessionId,
      })
      await call(teammate.token, `/agent/conversations/${chat.sessionId}/channel-messages`, {
        text: 'Minutes, please E2E_DELIVERY:teammate-bot',
      })
      await page.getByRole('tab', { name: 'Bots' }).click()
      await page.getByText('Scribe room').first().click()
      const post = page.locator('.group\\/post', {
        has: page.getByText('POSTED E2E_DELIVERY:teammate-bot', { exact: true }),
      })

      await post.waitFor({ timeout: 60_000 })
      // The face, not only the runtime mark.
      await post.locator('img[src*="bot-avatars/07-ada"]').first().waitFor({ timeout: 10_000 })
      await page.screenshot({ path: `${artifacts}/teammate-bot-post.png` })
    },
  },
]
