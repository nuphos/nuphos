// #3273: a question is its card's one-line title; what to decide from goes in its body.
import { must } from './binding-access-scenarios.ts'
import { calledTool } from './computer-scenarios.ts'
import { artifacts } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Scenario } from './ui.ts'
import type { Locator } from 'playwright-core'

/** How many lines of text an element draws. */
const lines = (element: Locator) =>
  element.evaluate((el) =>
    Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)),
  )

export const decisionTitleScenarios: Scenario[] = [
  {
    name: 'a question longer than one line is refused, and its card and the Inbox draw one line',
    run: async (page, stack) => {
      const ask = (question: string, marker: string) => {
        const args = {
          label: 'Ask',
          category: 'approval',
          question,
          body: 'Idle since the migration.',
          options: ['Delete', 'Keep'],
        }

        return send(page, `Ask it E2E_CALL request_user_decision ${JSON.stringify(args)} ${marker}`)
      }

      await newTask(page)
      await ask(
        `Delete the staging cluster? ${'It has been idle for thirty days. '.repeat(4)}`,
        'E2E_DELIVERY:too-long',
      )
      await page.getByText('ACK E2E_DELIVERY:too-long').waitFor()
      const refused = await calledTool(stack, 'request_user_decision')

      must(
        refused.includes('Keep the question to one short line (at most 120 characters)'),
        `a long question to be refused, got ${refused}`,
      )
      // 118 characters: more than one line of the card, which cuts it.
      const question =
        'Delete the staging cluster that has been idle for thirty days, costs forty dollars a day and has no deploys since then?'

      await ask(question, 'E2E_DELIVERY:one-line')
      const card = page.locator(`[data-decision-question="${question}"] h3`)

      await card.waitFor()
      must(
        (await lines(card)) === 1,
        `the card's question to be one line, got ${String(await lines(card))}`,
      )
      await page.getByText('Idle since the migration.').last().waitFor()
      await page.screenshot({ path: `${artifacts}/decision-one-line-card.png` })

      await page.getByRole('tab', { name: 'Inbox' }).click()
      await page.locator('[data-inbox-question]', { hasText: 'Delete the staging cluster' }).click()
      const heading = page.getByRole('heading', { level: 1, name: question })

      await heading.waitFor()
      must(
        (await lines(heading)) === 1,
        `the Inbox question to be one line, got ${String(await lines(heading))}`,
      )
      await page.screenshot({ path: `${artifacts}/decision-one-line-inbox.png` })
    },
  },
]
