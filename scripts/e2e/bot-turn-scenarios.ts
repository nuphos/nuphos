// Scenarios about a Bot's own session, opened over its chat. They run after the channel scenarios.
import { artifacts } from './processes.ts'

import type { Scenario } from './ui.ts'

export const botTurnScenarios: Scenario[] = [
  {
    // #3309: Switch runtime in a Bot's own failed turn also opened its chat's list, underneath.
    name: "Switch runtime on a Bot's failed turn opens one runtime list",
    run: async (page) => {
      await page.getByRole('tab', { name: 'Bots' }).click()
      await page.locator('[data-sidebar-row]').filter({ hasText: 'E2E Bot' }).first().click()
      await page.getByText('Message E2E Bot', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'Task', exact: true }).click()
      const task = page.locator('.t-bot-task-mode')

      // Sent in the Bot's own session, not its chat: the Bot reads its chat's recent posts on
      // every later wake, and the fixture would refuse each of those turns as out of usage too.
      await task.getByRole('textbox').last().click()
      await page.keyboard.type('Out of usage E2E_USAGE_LIMIT E2E_DELIVERY:bot-usage')
      await page.keyboard.press('Enter')
      await task.getByText('You’ve hit your usage limit').last().waitFor()
      await task.getByRole('button', { name: 'Switch runtime' }).click()
      const lists = page.getByRole('menu')

      await lists.first().waitFor()
      // Long enough for a second list to have opened, had there been one.
      await new Promise((resolve) => setTimeout(resolve, 1000))
      await page.screenshot({ path: `${artifacts}/bot-turn-switch-runtime-light.png` })
      const open = await lists.count()

      await page.keyboard.press('Escape')
      await task.getByRole('button', { name: 'Back to conversation' }).click()
      // The scenarios after this one find a single composer on the page.
      await task.waitFor({ state: 'detached' })
      if (open !== 1) throw new Error(`Switch runtime opened ${String(open)} runtime lists`)
    },
  },
]
