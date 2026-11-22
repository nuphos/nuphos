// #4619: a move used to wait for the turn to end; it stops the turn as Stop does instead.
import { agentEvents, agentLog } from './agent-log.ts'
import { artifacts, until } from './processes.ts'
import { newTask, pickAgent, send } from './ui.ts'

import type { Scenario } from './ui.ts'

// It runs a Task on the second agent, so it runs after the delegation scenario.
export const moveMidTurnScenarios: Scenario[] = [
  {
    name: 'move a Task while it answers, and its turn stops and the next message runs on the new agent',
    run: async (page, stack) => {
      await newTask(page)
      await pickAgent(page, 'E2E fixture agent')
      await send(page, 'Work until moved E2E_HOLD E2E_DELIVERY:move-held')
      await until('the agent to start the held turn', async () =>
        agentEvents(stack).includes('start E2E_DELIVERY:move-held'),
      )
      await pickAgent(page, 'E2E second agent')
      await page
        .getByText('moved this task from E2E fixture agent to E2E second agent')
        .filter({ visible: true })
        .waitFor()
      await page.getByText('Turn stopped').filter({ visible: true }).waitFor()
      await until('the held turn to be cancelled', async () =>
        agentEvents(stack).includes('cancelled E2E_DELIVERY:move-held'),
      )
      await send(page, 'Now on the new agent E2E_DELIVERY:move-after')
      await until('the next message to start on the new agent', async () =>
        agentEvents(stack).includes('start E2E_DELIVERY:move-after'),
      )
      const after = agentLog(stack).find((entry) => entry.marker === 'E2E_DELIVERY:move-after')

      if (after?.agent !== 'second')
        throw new Error(`Not on the new agent: ${JSON.stringify(after)}`)
      await page.screenshot({ path: `${artifacts}/move-mid-turn-light.png` })
      // The moved history still says E2E_HOLD, so the fixture holds this turn too.
      await page.locator('button[title="Stop"]:visible').click()
      await until('the next turn to be stopped', async () =>
        agentEvents(stack).includes('cancelled E2E_DELIVERY:move-after'),
      )
    },
  },
]
