// #3250: people meet Bots and Tasks, so no label on screen says "Agent".
// Runs in the Task the scenario before opened and answered.
import { agentEvents } from './agent-log.ts'
import { artifacts, until } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

async function noAgentLabel(page: Page, shot: string) {
  await page.screenshot({ path: `${artifacts}/${shot}.png` })
  const labels = await page
    .getByText(/^Agents?$/)
    .filter({ visible: true })
    .count()

  if (labels > 0) throw new Error(`${String(labels)} visible labels say Agent on ${shot}`)
}

export const agentWordScenarios: Scenario[] = [
  {
    name: 'a Task and the shortcuts list never say Agent',
    run: async (page) => {
      await noAgentLabel(page, 'agent-words-task')
      await page.getByRole('button', { name: 'Help', exact: true }).click()
      await page.getByRole('menuitem', { name: /Keyboard shortcuts/ }).click()
      await page.getByText('Send message', { exact: true }).waitFor()
      await noAgentLabel(page, 'agent-words-shortcuts')
      await page.keyboard.press('Escape')
    },
  },
  {
    // Batch 2 of #3250: the composer says Replying..., not "Agent is replying...".
    name: 'a Task at work says it is replying, not that an agent is',
    run: async (page, stack) => {
      await newTask(page)
      await send(page, 'Work until stopped E2E_HOLD E2E_DELIVERY:words')
      await until('the held turn to start', async () =>
        agentEvents(stack).includes('start E2E_DELIVERY:words'),
      )
      await page.getByText('Replying...', { exact: true }).waitFor()
      await page.screenshot({ path: `${artifacts}/agent-words-replying.png` })
      await page.locator('button[title="Stop"]').click()
      await page.getByText('Turn stopped').waitFor()
    },
  },
]
