// Scenarios about a Bot's own session, opened over its chat. They run after the channel scenarios.
import { agentLog } from './agent-log.ts'
import { artifacts, until } from './processes.ts'

import type { Scenario } from './ui.ts'

export const botTurnScenarios: Scenario[] = [
  {
    // #3309: Switch runtime in a Bot's own failed turn also opened its chat's list, underneath.
    name: "Switch runtime on a Bot's failed turn opens one runtime list",
    run: async (page, stack) => {
      const marker = 'E2E_DELIVERY:bot-usage'

      await page.getByRole('tab', { name: 'Bots' }).click()
      await page.locator('[data-sidebar-row]').filter({ hasText: 'E2E Bot' }).first().click()
      await page.getByText('Message E2E Bot', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'Task', exact: true }).click()
      const task = page.locator('.t-bot-task-mode')

      await task.getByRole('textbox').last().click()
      await page.keyboard.type(`Out of usage E2E_USAGE_LIMIT ${marker}`)
      await page.keyboard.press('Enter')
      await task.getByText('You’ve hit your usage limit').last().waitFor()
      await task.getByRole('button', { name: 'Switch runtime' }).click()
      const lists = page.getByRole('menu')

      await lists.first().waitFor()
      // Long enough for a second list to have opened, had there been one.
      await new Promise((resolve) => setTimeout(resolve, 1000))
      await page.screenshot({ path: `${artifacts}/bot-turn-switch-runtime-light.png` })
      const open = await lists.count()

      if (open !== 1) throw new Error(`Switch runtime opened ${String(open)} runtime lists`)
      // The refused turn stays with the Bot and would ride along with its next turn, so the
      // Bot moves on from this list and the turn runs once on the second agent. It stays there.
      await lists.getByText('E2E second agent').click()
      await page.getByRole('menuitem', { name: /^E2E second agent.*Claude Code/ }).click()
      await until('the refused turn to finish on the second agent', async () =>
        agentLog(stack).some(
          (entry) =>
            entry.agent === 'second' && entry.marker === marker && entry.event === 'finish',
        ),
      )
      await task.getByRole('button', { name: 'Back to conversation' }).click()
      // The scenarios after this one find a single composer on the page.
      await task.waitFor({ state: 'detached' })
    },
  },
]
