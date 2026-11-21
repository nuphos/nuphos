// Scenarios about the agent's own slash commands in the composer.
import { agentEvents } from './agent-log.ts'
import { until } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

/** Types `/e2e` into the composer, waits for `command` in the menu, then clears it again. */
async function menuLists(page: Page, command: string) {
  await page.getByRole('textbox', { name: 'Message' }).click()
  await page.keyboard.type('/e2e')
  await page.getByText(command, { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  for (let i = 0; i < 4; i++) await page.keyboard.press('Backspace')
}

export const commandScenarios: Scenario[] = [
  {
    // #3090: a run's snapshots carry the agent's slash commands only when they change.
    name: 'the slash menu keeps the agent’s commands during a turn and after a reload',
    run: async (page, stack) => {
      await newTask(page)
      await send(page, 'List and work E2E_COMMANDS E2E_HOLD E2E_DELIVERY:commands')
      await until('the agent to start the held turn', async () =>
        agentEvents(stack).includes('start E2E_DELIVERY:commands'),
      )
      await page.getByText('E2E long step').first().waitFor()
      await menuLists(page, '/e2e-review')
      // Reopened mid-turn, the run replays from its first frame; no list is remembered locally.
      await page.evaluate(() => localStorage.removeItem('nuphos.agentCommands.v1'))
      await page.reload()
      await page.getByText('E2E long step').first().waitFor()
      await menuLists(page, '/e2e-review')
      await page.locator('button[title="Stop"]:visible').click()
      await page.getByText('Turn stopped').waitFor()
    },
  },
]
