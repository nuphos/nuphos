// #3548: an answer given in the Inbox shows in the Bot chat as the answerer's reply to the
// question, quoted inside their bubble, and wakes the Bot no more than the answer itself does.
import { agentEvents, agentLog } from '../agent-log.ts'
import { artifacts, until } from '../processes.ts'
import { send } from '../ui.ts'

import type { Stack } from '../stack.ts'
import type { Scenario } from '../ui.ts'
import type { Page } from 'playwright-core'

const QUESTION = 'Which marker should the fixture use?'
const ANSWER = 'E2E_DELIVERY:answered'

const count = (stack: Stack, event: string) =>
  agentEvents(stack).filter((entry) => entry === event).length
const channelWakes = (stack: Stack) =>
  agentLog(stack).filter((entry) => entry.event === 'channel').length

async function openBotChat(page: Page) {
  await page.getByRole('tab', { name: /^Bots/ }).click()
  await page.locator('[data-sidebar-row]').filter({ hasText: 'E2E Bot' }).first().click()
  await page.locator('[aria-placeholder="Message E2E Bot"]').waitFor()
}

async function theme(page: Page, name: 'light' | 'dark') {
  await page.evaluate((name) => {
    document.documentElement.classList.remove('light', 'dark')
    document.documentElement.classList.add(name)
  }, name)
  await page.waitForTimeout(500)
}

const scenario: Scenario = {
  name: "an answer given in the Inbox is the answerer's reply in the Bot chat, quoted in the bubble",
  run: async (page, stack) => {
    await openBotChat(page)
    await send(page, 'Ask me E2E_ASK E2E_DELIVERY:inbox-reply')
    await page.getByText('POSTED E2E_DELIVERY:inbox-reply', { exact: true }).waitFor()
    const wakes = channelWakes(stack)
    const answered = count(stack, `finish ${ANSWER}`)

    await page.getByRole('tab', { name: /^Inbox/ }).click()
    await page.locator('[data-inbox-question]').filter({ hasText: QUESTION }).first().click()
    await page.getByRole('button', { name: ANSWER }).last().click()
    await until(
      'the answer to reach the Bot',
      async () => count(stack, `finish ${ANSWER}`) > answered,
    )

    await openBotChat(page)
    const post = page.locator('.group\\/post', { hasText: ANSWER }).last()
    const bubble = post.locator('.user-message-bubble')

    // The quote is the bubble's first line: the Bot's name, then its question.
    await bubble.getByRole('button', { name: new RegExp(`^E2E Bot\\s*${QUESTION}`) }).waitFor()
    await post.getByText('Answered in Inbox', { exact: true }).waitFor()
    if ((await page.locator('[data-decision-record]').count()) > 0)
      throw new Error('An answer left the old "answered:" line instead of a post')

    // The posts were written, not posted: no channel notice woke the Bot for them.
    await page.waitForTimeout(3_000)
    if (channelWakes(stack) !== wakes)
      throw new Error(`The answer's posts woke the Bot: ${String(channelWakes(stack) - wakes)}`)

    await post.scrollIntoViewIfNeeded()
    const themed = await page.evaluate(() => document.documentElement.className)

    for (const name of ['light', 'dark'] as const) {
      await theme(page, name)
      await page.screenshot({ path: `${artifacts}/inbox-answer-${name}.png` })
    }
    // Replying to the answer: the bar names it and quotes it on two lines.
    await post.hover()
    await post.getByRole('button', { name: 'Reply', exact: true }).click()
    await page
      .getByText(/^Replying to /)
      .last()
      .waitFor()
    for (const name of ['light', 'dark'] as const) {
      await theme(page, name)
      await page.screenshot({ path: `${artifacts}/inbox-answer-replying-${name}.png` })
    }
    await page.getByRole('button', { name: 'Cancel reply' }).click()
    await page.evaluate((themed) => {
      document.documentElement.className = themed
    }, themed)
  },
}

export default scenario
