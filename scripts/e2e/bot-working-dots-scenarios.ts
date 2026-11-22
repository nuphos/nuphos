// A working Bot with no chat yet: no spinner, no greyed name, no typing dots (#3321, #3522).
import { agentEvents } from './agent-log.ts'
import { loadingFree } from './channel-helpers.ts'
import { artifacts, until } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Scenario } from './ui.ts'

export const botWorkingDotsScenarios: Scenario[] = [
  {
    // #3321: a working Bot with no chat showed a spinner, one with a chat the work dots.
    name: 'a working Bot with no chat shows its latest message, with no loading state',
    run: async (page, stack) => {
      const api = async (method: string, path: string) => {
        const response = await fetch(`${stack.apiUrl}${path}?teamId=${stack.teamId}`, {
          method,
          headers: { authorization: `Bearer ${stack.token}` },
        })

        if (!response.ok) throw new Error(`${path} answered ${String(response.status)}`)

        return (await response.json()) as {
          conversations?: { sessionId: string; firstMessage?: string }[]
        }
      }

      await newTask(page)
      await send(page, 'Keep working E2E_HOLD E2E_DELIVERY:solo-bot')
      await until('the held turn to start', async () =>
        agentEvents(stack).includes('start E2E_DELIVERY:solo-bot'),
      )
      const listed = (await api('GET', '/agent/conversations')).conversations ?? []
      const solo = listed.find((c) => c.firstMessage?.includes('solo-bot'))

      if (!solo) throw new Error('The held Task is not listed')
      await api('POST', `/agent/conversations/${solo.sessionId}/bot`)
      await page.getByRole('tab', { name: 'Bots' }).click()
      const rows = page.locator('[data-sidebar-row]')
      const row = rows.filter({ hasText: 'E2E_DELIVERY:solo-bot' })

      await row.getByText('E2E_DELIVERY:solo-bot', { exact: false }).last().waitFor()
      await page.waitForTimeout(1_000)
      await page.evaluate(() => {
        document.documentElement.classList.remove('dark')
        document.documentElement.classList.add('light')
      })
      await page.screenshot({ path: `${artifacts}/bot-without-chat-working-light.png` })
      if (agentEvents(stack).includes('cancelled E2E_DELIVERY:solo-bot'))
        throw new Error('The held turn ended before the working row was checked')
      await loadingFree(row, 'While the Bot without a chat works')
      // It has no chat to type in, so no dots stand in for its latest message.
      if ((await row.locator('.t-typing-dot').count()) > 0)
        throw new Error('The working Bot without a chat shows typing dots')
      await api('POST', `/agent/conversations/${solo.sessionId}/cancel-runtime`)
      await until('the held turn to stop', async () =>
        agentEvents(stack).includes('cancelled E2E_DELIVERY:solo-bot'),
      )
      // Back in the Bot chat, for the scenarios that follow.
      await rows.filter({ hasText: 'E2E Bot' }).first().click()
      await page.locator('[data-post-id]:visible').first().waitFor()
    },
  },
]
