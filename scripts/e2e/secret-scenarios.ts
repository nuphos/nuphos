// #3474: a secret request's card in a chat could only be answered with the secret.
import { agentEvents } from './agent-log.ts'
import { artifacts, until } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Scenario } from './ui.ts'

export const secretScenarios: Scenario[] = [
  {
    // The Inbox's Dismiss for a secret is in inbox-scenarios.ts; this is the card in the chat.
    name: 'a secret request is dismissed on its card in the chat, and the agent gets no value',
    run: async (page, stack) => {
      const dismissals = () =>
        agentEvents(stack).filter((event) => event.startsWith('dismissed')).length

      await page.evaluate(() => {
        document.documentElement.classList.remove('dark')
        document.documentElement.classList.add('light')
      })
      await newTask(page)
      await send(page, 'Ask me E2E_ASK_SECRET E2E_DELIVERY:secret-chat')
      await page.getByText('ACK E2E_DELIVERY:secret-chat').waitFor()
      const card = page
        .locator('[data-tool-call-id]:visible')
        .filter({ hasText: 'E2E_API_KEY' })
        .last()
      const dismiss = card.getByRole('button', { name: 'Dismiss', exact: true })

      await dismiss.waitFor()
      await card.screenshot({ path: `${artifacts}/secret-card-dismiss.png` })
      const before = dismissals()

      await dismiss.click()
      await page
        .getByText(/was dismissed by .*: no answer is coming/)
        .last()
        .waitFor()
      await until(
        'the agent to be told the secret is not coming',
        async () => dismissals() === before + 1,
      )
      await page.screenshot({ path: `${artifacts}/secret-card-dismissed.png` })
    },
  },
  {
    // #4029: a credential question with options had no Other…, only its options.
    name: 'a credential question with options is answered in words with Other…',
    run: async (page) => {
      await page.evaluate(() => {
        document.documentElement.classList.remove('dark')
        document.documentElement.classList.add('light')
      })
      await newTask(page)
      await send(page, 'Ask me E2E_ASK_CREDENTIAL E2E_DELIVERY:credential-ask')
      await page.getByText('ACK E2E_DELIVERY:credential-ask').waitFor()
      await page.getByRole('button', { name: 'Other…' }).last().click()
      await page.getByLabel('Your answer').last().fill('E2E_DELIVERY:credential-words')
      await page.screenshot({ path: `${artifacts}/credential-question-other.png` })
      await page.keyboard.press('Enter')
      await page.getByText('ACK E2E_DELIVERY:credential-words').waitFor()
    },
  },
]
