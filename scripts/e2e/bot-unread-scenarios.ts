// Scenarios about a Bot row's unread dot, in the chat of the Bot an earlier scenario created.
import { agentEvents, agentLog } from './agent-log.ts'
import { botSubtaskModelScenarios } from './bot-subtask-model-scenarios.ts'
import { botSubtaskProgressProbe } from './bot-subtask-progress-probe.ts'
import { artifacts, until } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Scenario } from './ui.ts'

export const botUnreadScenarios: Scenario[] = [
  {
    // #3329: a reply in a Bot's sub-Task put a second dot on the Bot's row.
    name: "a Bot row's only dot is the Bot's own unread message, never its sub-Task's",
    run: async (page, stack) => {
      const channelId = agentLog(stack).find((entry) => entry.event === 'channel')?.detail
      const bots = page.getByRole('tabpanel', { name: 'Bots' })
      // The Bot's chat row and its sub-Task rows; a teammate's group chat may be unread too.
      const dots = bots
        .locator('[data-sidebar-row]')
        .filter({ hasText: /E2E Bot|E2E bot kid/ })
        .locator('[aria-label="Unread reply"]')
      const get = async <T>(path: string): Promise<T> => {
        const response = await fetch(`${stack.apiUrl}${path}`, {
          headers: { authorization: `Bearer ${stack.token}` },
        })

        if (!response.ok) throw new Error(`${path} answered ${String(response.status)}`)

        return (await response.json()) as T
      }

      type Row = {
        sessionId: string
        title?: string
        unread?: boolean
      }
      const rows = async () =>
        (
          await get<{ conversations: Row[] }>(
            `/agent/conversations?teamId=${stack.teamId}&limit=200`,
          )
        ).conversations
      const badge = async () =>
        (await get<{ count: number }>(`/agent/unread-count?teamId=${stack.teamId}`)).count
      const shot = async (name: string) => {
        await page.evaluate(() => {
          document.documentElement.classList.remove('dark')
          document.documentElement.classList.add('light')
        })
        await page.screenshot({ path: `${artifacts}/${name}.png` })
      }

      if (!channelId) throw new Error('The Bot has not answered in its chat yet')
      // Unread elsewhere may change meanwhile (the Bot's own session); the badge follows only that.
      const others = async (skip?: string) =>
        (await rows()).filter((row) => row.unread && row.sessionId !== skip).length

      await page.waitForTimeout(2_000)
      const badgeBefore = await badge()
      const othersBefore = await others()

      await page.getByRole('tab', { name: 'Bots' }).click()
      await bots.locator('[data-sidebar-row]').filter({ hasText: 'E2E Bot' }).first().click()
      // Read in place: the Bot's own post here is read, its sub-Task's reply is not.
      // On the same agent: the runtime scenarios expect the second one unused.
      await send(page, 'Hand this off E2E_SUBTASK E2E_DELIVERY:bot-handoff')
      await page.getByText('POSTED E2E_DELIVERY:bot-handoff', { exact: true }).waitFor()
      await until('the sub-Task to reply', async () =>
        agentEvents(stack).includes('finish E2E_DELIVERY:bot-kid'),
      )
      await newTask(page)
      await page.getByRole('tab', { name: 'Bots' }).click()
      // Long enough for the list to bring the sub-Task's reply.
      await page.waitForTimeout(5_000)
      await shot('bot-unread-subtask-light')
      if ((await dots.count()) !== 0)
        throw new Error(`A sub-Task's reply put ${String(await dots.count())} dots on Bots`)
      // A Bot's sub-Task is listed only under the Bot; its unread flag and the badge are the server's.
      const kid = (await rows()).find((row) => row.title === 'E2E bot kid')

      if (!kid) throw new Error('The Bot started no sub-Task')
      if (kid.unread) throw new Error("The Bot's sub-Task is unread")
      const raised = (await badge()) - badgeBefore - ((await others(kid.sessionId)) - othersBefore)

      if (raised !== 0) throw new Error(`The sub-Task's reply moved the badge by ${String(raised)}`)

      // Now the Bot's own message, unread, with the sub-Task's reply still under it. The Bots
      // tab reopened the Bot's chat, which would read it at once; another chat leaves it unread.
      const side = await fetch(`${stack.apiUrl}/agent/channels`, {
        method: 'POST',
        headers: { authorization: `Bearer ${stack.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ teamId: stack.teamId, title: 'E2E side chat', group: true }),
      })

      if (!side.ok) throw new Error(`Creating a chat failed: ${String(side.status)}`)
      await bots.getByText('E2E side chat').first().click()
      const response = await fetch(
        `${stack.apiUrl}/agent/conversations/${channelId}/channel-messages`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${stack.token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ teamId: stack.teamId, text: 'Any news? E2E_DELIVERY:bot-own' }),
        },
      )

      if (!response.ok) throw new Error(`Posting failed: ${String(response.status)}`)
      await until('the Bot to reply in its chat', async () => (await dots.count()) > 0)
      await page.waitForTimeout(2_000)
      await shot('bot-unread-own-light')
      if ((await dots.count()) !== 1)
        throw new Error(`A Bot with its own unread shows ${String(await dots.count())} dots`)
      // Back in the Bot's chat, where the channel scenarios carry on.
      await bots.locator('[data-sidebar-row]').filter({ hasText: 'E2E Bot' }).first().click()
    },
  },
  // Then, in the same Bot's chat, the model its sub-Task names.
  ...botSubtaskModelScenarios,
  ...botSubtaskProgressProbe,
]
