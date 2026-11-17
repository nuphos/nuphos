// #3250: people meet Bots and Tasks, so no label on screen says "Agent".
// Runs in the Task the scenario before opened and answered.
import { artifacts } from './processes.ts'
import { newTask } from './ui.ts'

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
    // Batch 2 of #3250: a new Task's summary says sub-tasks, not sub-agents.
    name: "a new Task's summary names sub-tasks, not sub-agents",
    run: async (page) => {
      const toggle = page.getByRole('button', { name: /task summary$/ }).first()
      const empty = page.getByText(/^Pull requests, sub-/)

      await newTask(page)
      await toggle.click()
      await empty.waitFor()
      // The panel slides in; shoot it once it has settled.
      await page.waitForTimeout(1_000)
      await page.screenshot({ path: `${artifacts}/agent-words-summary.png` })
      const text = (await empty.textContent()) ?? ''

      if (/\bagents?\b/i.test(text)) throw new Error(`The summary says: ${text}`)
      await toggle.click()
    },
  },
]
