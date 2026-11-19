// Scenarios about the Inbox's question cards: snoozing them, and dismissing them with a reason.
import { agentEvents } from './agent-log.ts'
import { artifacts, until } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Scenario } from './ui.ts'

export const inboxScenarios: Scenario[] = [
  {
    // #3231: the Inbox's Skip only moved on. Snooze sets a question aside; Dismiss tells the agent why.
    name: 'snooze a question in the Inbox and bring it back; dismiss one with a reason for the agent',
    run: async (page, stack) => {
      await newTask(page)
      await send(page, 'Ask me E2E_ASK E2E_DELIVERY:inbox')
      await page.getByText('ACK E2E_DELIVERY:inbox').waitFor()
      await page.getByRole('tab', { name: 'Inbox' }).click()
      await page.getByRole('button', { name: 'Snooze', exact: true }).click()
      await page.getByRole('menuitem', { name: '1 hour' }).click()
      const snoozed = page.locator('[data-snoozed-question]')

      await snoozed.first().hover()
      await page.getByRole('button', { name: 'Unsnooze' }).first().click()
      await until('the question to leave Snoozed', async () => (await snoozed.count()) === 0)
      await page.getByRole('button', { name: 'Dismiss', exact: true }).click()
      await page
        .getByRole('textbox', { name: 'Reason (optional)' })
        .fill('E2E_DELIVERY:inbox-reason')
      await page.keyboard.press('Enter')
      await page.getByText('Dismissed', { exact: true }).waitFor()
      await until('the agent to be told why, once the Undo window passes', async () =>
        agentEvents(stack).includes('dismissed E2E_DELIVERY:inbox-reason'),
      )
    },
  },
  {
    // #3474: a secret request could only be answered with the secret. Dismiss closes it, and
    // the agent that asked is told why.
    name: 'dismiss a secret request in the Inbox with a reason, and the agent is told why',
    run: async (page, stack) => {
      await newTask(page)
      await send(page, 'Ask me E2E_ASK_SECRET E2E_DELIVERY:secret')
      await page.getByText('ACK E2E_DELIVERY:secret').waitFor()
      await page.getByRole('tab', { name: 'Inbox' }).click()
      await page
        .locator('[data-inbox-question]')
        .filter({ hasText: 'Which API key should the fixture use?' })
        .click()
      await page.getByRole('button', { name: 'Send securely' }).waitFor()
      await page.getByRole('button', { name: 'Dismiss', exact: true }).click()
      await page
        .getByRole('textbox', { name: 'Reason (optional)' })
        .fill('E2E_DELIVERY:secret-reason')
      await page.keyboard.press('Enter')
      await page.getByText('Dismissed', { exact: true }).waitFor()
      await page.screenshot({ path: `${artifacts}/secret-dismissed.png` })
      await until('the agent to be told why the secret is not coming', async () =>
        agentEvents(stack).includes('dismissed E2E_DELIVERY:secret-reason'),
      )
    },
  },
]
