// Scenarios about a Bot's own session, opened over its chat. They run after the runtime
// scenarios: they leave the Bot on the second agent, which those need unused until then.
import { agentLog } from './agent-log.ts'
import { checkDockToggleClear } from './chat-presentation.ts'
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

      await task.getByRole('button', { name: 'Toggle task summary' }).waitFor()
      // The Task slides in from the right; its header is measured once it has arrived.
      await page.waitForFunction(() => {
        const box = document.querySelector('.t-bot-task-mode')?.getBoundingClientRect()

        return box !== undefined && box.right <= window.innerWidth + 1
      })
      await page.waitForTimeout(300)
      // #3561: the Task's header kept its summary toggle under the workspace panel toggle.
      for (const theme of ['light', 'dark']) {
        await page.evaluate((value) => {
          document.documentElement.classList.remove('light', 'dark')
          document.documentElement.classList.add(value)
        }, theme)
        await checkDockToggleClear(page, `Bot Task header ${theme}`, '.t-bot-task-mode header')
        await page.getByRole('button', { name: 'Open workspace panel' }).click()
        await page.getByRole('button', { name: 'Close workspace panel' }).waitFor()
        await page.waitForTimeout(500)
        await page.screenshot({
          path: `${artifacts}/dock-toggle-Bot-Task-header-${theme}-open.png`,
        })
        await page.getByRole('button', { name: 'Close workspace panel' }).click()
        await page.getByRole('button', { name: 'Open workspace panel' }).waitFor()
      }
      await page.evaluate(() => {
        document.documentElement.classList.remove('dark')
        document.documentElement.classList.add('light')
      })
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
