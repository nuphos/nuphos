// Scenarios about a Bot row's unread dot, in the chat of the Bot an earlier scenario created.
// After the runtime scenarios: delegating runs the second agent, which they expect unused.
import { agentLog } from './agent-log.ts'
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
        .filter({ hasText: /E2E Bot|E2E child/ })
        .locator('[aria-label="Unread reply"]')
      const replies = () =>
        agentLog(stack).filter(
          (entry) => entry.event === 'finish' && entry.marker === 'E2E_DELIVERY:child',
        ).length
      const shot = async (name: string) => {
        await page.evaluate(() => {
          document.documentElement.classList.remove('dark')
          document.documentElement.classList.add('light')
        })
        await page.screenshot({ path: `${artifacts}/${name}.png` })
      }

      if (!channelId) throw new Error('The Bot has not answered in its chat yet')
      await page.getByRole('tab', { name: 'Bots' }).click()
      await bots.locator('[data-sidebar-row]').filter({ hasText: 'E2E Bot' }).first().click()
      const before = replies()

      // Read in place: the Bot's own post here is read, its sub-Task's reply is not.
      await send(page, 'Hand this off E2E_DELEGATE E2E_DELIVERY:bot-handoff')
      await page.getByText('POSTED E2E_DELIVERY:bot-handoff', { exact: true }).waitFor()
      await until('the sub-Task to reply', async () => replies() > before)
      await newTask(page)
      await page.getByRole('tab', { name: 'Bots' }).click()
      // Long enough for the list to bring the sub-Task's reply.
      await page.waitForTimeout(5_000)
      await shot('bot-unread-subtask-light')
      if ((await dots.count()) !== 0)
        throw new Error(`A sub-Task's reply put ${String(await dots.count())} dots on Bots`)

      // Now the Bot's own message, unread, with the sub-Task's reply still unread under it.
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
    },
  },
]
