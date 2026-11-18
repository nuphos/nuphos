// Group chats with Bots: a teammate's set up through the API, and one @mentioned from the composer.
import { client } from './binding-access-scenarios.ts'
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
      // #3298: a teammate's Bot's permission mode and model are its owner's to change.
      const offered = await page
        .getByRole('button', { name: /^(Authorization mode|Model settings)/ })
        .count()

      if (offered > 0) throw new Error(`A teammate's Bot offers ${String(offered)} of its settings`)
    },
  },
  {
    // #3430: a post's `@Name` of a Bot that joined the chat stayed plain text, unlike a person's.
    name: 'a Bot mentioned in a group chat shows as a mention chip that opens its chat',
    run: async (page, stack) => {
      const api = client(stack.apiUrl, stack.token)
      const created = async (path: string, body: object) => {
        const { status, body: answer } = await api('POST', path, { teamId: stack.teamId, ...body })

        if (status >= 300) throw new Error(`${path} answered ${String(status)}`)

        return answer as { sessionId: string }
      }
      // A name with no Latin letters, as the issue was reported with.
      const bot = await created('/agent/bots', { title: '書記', avatar: '07-ada' })
      const chat = await created('/agent/channels', { title: 'Mention room', group: true })

      await created(`/agent/conversations/${chat.sessionId}/agents`, { sessionId: bot.sessionId })
      await page.getByRole('tab', { name: 'Bots' }).click()
      await page.getByText('Mention room').first().click()
      await page.getByRole('textbox', { name: 'Message' }).click()
      await page.keyboard.type('@書記')
      await page.getByRole('option', { name: /書記/ }).first().click()
      await page.keyboard.type(' please summarize E2E_DELIVERY:bot-mention')
      await page.keyboard.press('Enter')
      await page.getByText('POSTED E2E_DELIVERY:bot-mention', { exact: true }).waitFor()
      await page.evaluate(() => {
        document.documentElement.classList.remove('dark')
        document.documentElement.classList.add('light')
      })
      await page.waitForTimeout(500)
      await page.screenshot({ path: `${artifacts}/bot-mention-group-chat-light.png` })
      // The viewer's own Bot: its chip is a button to its chat.
      const chip = page.locator(`.user-message-bubble [data-mention-bot-id="${bot.sessionId}"]`)

      await chip.getByText('@書記', { exact: true }).waitFor({ timeout: 10_000 })
      if ((await chip.evaluate((el) => el.tagName)) !== 'BUTTON')
        throw new Error("The viewer's own Bot's mention chip does not open it")
      await chip.click()
      await page.locator('[aria-placeholder="Message 書記"]').waitFor()
    },
  },
]
