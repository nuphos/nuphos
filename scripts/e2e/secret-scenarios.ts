// #3474: a secret request's card could only be answered with the secret.
import { agentEvents } from './agent-log.ts'
import { client, must } from './binding-access-scenarios.ts'
import { artifacts, until } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

type Listed = {
  conversations: { firstMessage?: string; inputRequests?: { id: string }[] }[]
}

const light = (page: Page) =>
  page.evaluate(() => {
    document.documentElement.classList.remove('dark')
    document.documentElement.classList.add('light')
  })

export const secretScenarios: Scenario[] = [
  {
    // #3474: a secret's card offered only its masked field, so it could not be declined.
    name: 'a secret request is dismissed on its card and in the Inbox, and the agent gets no value',
    run: async (page, stack) => {
      const dismissals = () =>
        agentEvents(stack).filter((event) => event.startsWith('dismissed')).length

      await light(page)
      await newTask(page)
      await send(page, 'Ask me E2E_ASK_SECRET E2E_DELIVERY:secret')
      await page.getByText('ACK E2E_DELIVERY:secret').waitFor()
      const card = page.locator('[data-tool-call-id]').filter({ hasText: 'E2E_TOKEN' }).last()

      await card.getByRole('button', { name: 'Dismiss', exact: true }).waitFor()
      await card.screenshot({ path: `${artifacts}/secret-card-dismiss.png` })
      const before = dismissals()

      await card.getByRole('button', { name: 'Dismiss', exact: true }).click()
      await page
        .getByText(/was dismissed by .*: no answer is coming/)
        .last()
        .waitFor()
      await until(
        'the agent to be told the secret was declined',
        async () => dismissals() === before + 1,
      )
      await page.screenshot({ path: `${artifacts}/secret-card-dismissed.png` })

      await send(page, 'Ask again E2E_ASK_SECRET E2E_DELIVERY:secret-again')
      await page.getByText('ACK E2E_DELIVERY:secret-again').waitFor()
      const listed = await client(stack.apiUrl, stack.token)(
        'GET',
        `/agent/conversations?teamId=${stack.teamId}&pendingDecision=true`,
      )
      const asked = (listed.body as Listed).conversations.find((conversation) =>
        conversation.firstMessage?.includes('E2E_DELIVERY:secret'),
      )?.inputRequests?.[0]

      must(Boolean(asked), 'the second secret request to be listed')
      await page.getByRole('tab', { name: 'Inbox' }).click()
      await page.locator(`[data-inbox-question="${asked!.id}"]`).click()
      await page.getByText('E2E_TOKEN').first().waitFor()
      await page.screenshot({ path: `${artifacts}/secret-inbox.png` })
      await page.getByRole('button', { name: 'Dismiss', exact: true }).first().click()
      await page
        .getByRole('textbox', { name: 'Reason for the agent (optional)' })
        .fill('Use the existing API token E2E_DELIVERY:secret-reason')
      await page.screenshot({ path: `${artifacts}/secret-inbox-reason.png` })
      await page.keyboard.press('Enter')
      await until('the agent to get the reason in words, once the Undo window passes', async () =>
        agentEvents(stack).includes('dismissed E2E_DELIVERY:secret-reason'),
      )
    },
  },
]
