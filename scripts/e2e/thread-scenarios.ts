// Scenarios about the cards a Task shows for the threads it starts and messages.
import { agentLog, delegatedTurn } from './agent-log.ts'
import { until } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

/** The line a thread card shows under its title: the verb, the agent and the status. */
async function cardLine(page: Page, verb: 'Messaged') {
  return await page
    .locator('span.flex', { has: page.getByText(verb, { exact: true }) })
    .last()
    .innerText()
}

export const threadScenarios: Scenario[] = [
  {
    // #2950: a message to a moved thread showed the agent the thread had started on.
    name: 'a message to a thread moved to another agent shows the agent it ran on',
    run: async (page, stack) => {
      await newTask(page)
      await send(page, 'Start and move a thread E2E_HOP E2E_DELIVERY:hop')
      await until('the moved thread to answer on its new agent', async () =>
        delegatedTurn(stack, 'E2E_DELIVERY:hop-again'),
      )
      await page.getByText('ACK E2E_DELIVERY:hop', { exact: true }).waitFor()
      // The agent the message to the moved thread ran on, whichever the Task started on.
      const after =
        delegatedTurn(stack, 'E2E_DELIVERY:hop-again')?.agent === 'second'
          ? 'E2E second agent'
          : 'E2E fixture agent'
      const hopped = agentLog(stack).find((entry) => entry.event === 'hopped')?.detail

      await until('the Messaged card to name an agent', async () =>
        (await cardLine(page, 'Messaged')).includes('E2E'),
      )
      const messaged = await cardLine(page, 'Messaged')

      if (!messaged.includes(after)) {
        throw new Error(`The Messaged card shows "${messaged}", not ${after} (${hopped ?? ''})`)
      }
    },
  },
]
