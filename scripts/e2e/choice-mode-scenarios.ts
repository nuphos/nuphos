// #3468: a single- and a multi-select question are one card, in a chat and in the Inbox.
import { agentEvents } from './agent-log.ts'
import { must } from './binding-access-scenarios.ts'
import { artifacts, until } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

const SINGLE = 'Which region ships first?'
const MULTI = 'Which regions ship today?'
const SEVERAL = 'How should the staging rollout go?'

const light = (page: Page) =>
  page.evaluate(() => {
    document.documentElement.classList.remove('dark')
    document.documentElement.classList.add('light')
  })

/** A question's card in the chat. */
const card = (page: Page, question: string) =>
  page.locator(`[data-decision-question="${question}"]:visible`)

/** Opens a question of the Inbox list and waits for it to be drawn. */
async function openInInbox(page: Page, question: string) {
  await page.locator('[data-inbox-question]', { hasText: question }).click()
  await page.getByText(question).filter({ visible: true }).last().waitFor()
  await page.waitForTimeout(500)
}

export const choiceModeScenarios: Scenario[] = [
  {
    name: 'a single- and a multi-select question are one card, answered through the Inbox',
    run: async (page, stack) => {
      const ask = async (args: object, marker: string) => {
        const call = {
          label: 'Ask',
          category: 'preference',
          body: 'The rollout starts after the freeze.',
          ...args,
        }

        await send(page, `Ask it E2E_CALL request_user_decision ${JSON.stringify(call)} ${marker}`)
        await page.getByText(`ACK ${marker}`).waitFor()
      }
      const delivered = (marker: string) =>
        until(`${marker} to reach the agent`, () =>
          Promise.resolve(agentEvents(stack).includes(`finish ${marker}`)),
        )

      await newTask(page)
      await light(page)
      await ask(
        { question: SINGLE, options: ['E2E_DELIVERY:one-us', 'E2E_DELIVERY:one-eu'] },
        'E2E_DELIVERY:ask-single',
      )
      await ask(
        {
          question: MULTI,
          options: ['E2E_DELIVERY:any-us', 'E2E_DELIVERY:any-eu', 'E2E_DELIVERY:any-ap'],
          multiSelect: true,
        },
        'E2E_DELIVERY:ask-multi',
      )
      await page.locator(`[data-decision-question="${MULTI}"]:visible`).scrollIntoViewIfNeeded()
      await page.screenshot({ path: `${artifacts}/choice-modes-chat.png` })
      // Each card on its own, for its row of options up close.
      await card(page, SINGLE).screenshot({ path: `${artifacts}/choice-modes-card-single.png` })
      await card(page, MULTI).screenshot({ path: `${artifacts}/choice-modes-card-multi.png` })
      // Several questions in one card, one of them multi-select, in its own Task.
      await newTask(page)
      await ask(
        {
          question: SEVERAL,
          questions: [
            {
              question: 'Which regions get it first?',
              options: ['us-east', 'eu-west'],
              multiSelect: true,
            },
            { question: 'Keep the old cluster?', options: ['Keep a week', 'Delete it'] },
          ],
        },
        'E2E_DELIVERY:ask-several',
      )
      await page.locator(`[data-decision-question="${SEVERAL}"]:visible`).scrollIntoViewIfNeeded()
      await page.screenshot({ path: `${artifacts}/choice-modes-chat-several.png` })
      await card(page, SEVERAL).screenshot({ path: `${artifacts}/choice-modes-card-several.png` })

      await page.getByRole('tab', { name: 'Inbox' }).click()
      await light(page)
      await openInInbox(page, SINGLE)
      await page.screenshot({ path: `${artifacts}/choice-modes-inbox-single.png` })
      await openInInbox(page, SEVERAL)
      await page.screenshot({ path: `${artifacts}/choice-modes-inbox-several.png` })
      await openInInbox(page, MULTI)
      await page.screenshot({ path: `${artifacts}/choice-modes-inbox-multi.png` })

      // The multi-select is the Inbox page a single-select is, with checkboxes and Send.
      must(
        (await page.getByRole('heading', { level: 1, name: MULTI }).count()) === 1,
        'the multi-select question to lead the Inbox page, as a single-select one does',
      )
      must(
        (await page.getByRole('checkbox').count()) === 3 &&
          (await page.getByRole('button', { name: 'Send answer' }).count()) === 0,
        'the multi-select options to be checkboxes in the one option row',
      )
      // Picked out of order: the agent reads the picks as they were made, the last one last.
      await page.getByRole('checkbox', { name: 'E2E_DELIVERY:any-ap' }).click()
      await page.getByRole('checkbox', { name: 'E2E_DELIVERY:any-us' }).click()
      await page.screenshot({ path: `${artifacts}/choice-modes-inbox-multi-picked.png` })
      await page
        .locator('article')
        .first()
        .screenshot({ path: `${artifacts}/choice-modes-inbox-multi-picked-zoom.png` })
      await page.getByRole('button', { name: 'Send', exact: true }).click()
      await delivered('E2E_DELIVERY:any-us')

      await openInInbox(page, SINGLE)
      await page.getByRole('button', { name: 'E2E_DELIVERY:one-eu' }).click()
      await delivered('E2E_DELIVERY:one-eu')
    },
  },
]
