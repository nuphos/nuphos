// #3147: clicking the model Claude Code's "Default" stands for, shown as current, pins it.
import { agentLog, firstAgentHolds } from './agent-log.ts'
import { until } from './processes.ts'
import { newTask, pickAgent, send } from './ui.ts'

import type { Scenario } from './ui.ts'

// It moves the Task to the second agent, so it runs after the delegation scenario.
export const defaultStandInScenarios: Scenario[] = [
  {
    name: 'pick the model the agent default stands for, move the Task, and it stays on that model',
    run: async (page, stack) => {
      const stopOffering = stack.offerDefaultStandIn()

      try {
        await newTask(page)
        await pickAgent(page, 'E2E fixture agent')
        await send(page, 'Before the pick E2E_DELIVERY:stand-in-picked')
        await page.getByText('ACK E2E_DELIVERY:stand-in-picked').waitFor()
        await page.getByRole('button', { name: /^Model settings/ }).click()
        await page.getByRole('menuitemcheckbox', { name: /^fixture(?!-)/ }).click()
        await page.keyboard.press('Escape')
        await until('the first agent to hold the picked model', async () =>
          firstAgentHolds(stack, 'E2E_DELIVERY:stand-in-picked', 'fixture'),
        )
        await pickAgent(page, 'E2E second agent')
        await page.getByText('moved this task from E2E fixture agent to E2E second agent').waitFor()
        await send(page, 'After the move E2E_DELIVERY:stand-in-moved')
        await page.getByText('ACK E2E_DELIVERY:stand-in-moved').waitFor()
      } finally {
        stopOffering()
      }
      const log = agentLog(stack)
      const turn = log.find(
        (entry) => entry.agent === 'second' && entry.marker === 'E2E_DELIVERY:stand-in-moved',
      )
      const session = log.find(
        (entry) => entry.event === 'session' && entry.sessionId === turn?.sessionId,
      )

      if (session?.defaults?.model !== 'fixture') {
        throw new Error(
          `The moved Task's session did not start on the picked model: ${JSON.stringify(session)}`,
        )
      }
    },
  },
]
