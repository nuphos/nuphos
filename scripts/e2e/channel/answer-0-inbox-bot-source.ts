// #3310: the Bot's name above its Inbox question opened the Bot's session as a Task,
// with the sidebar left on the Inbox.
import { agentEvents } from '../agent-log.ts'
import { must } from '../binding-access-scenarios.ts'
import { openBotChat } from '../channel-quotes.ts'
import { artifacts, until } from '../processes.ts'
import { send, setBotDetails } from '../ui.ts'

import type { Scenario } from '../ui.ts'

const scenario: Scenario = {
  name: "a Bot's name above its Inbox question opens the Bot's chat, with Bots in the sidebar",
  run: async (page, stack) => {
    await openBotChat(page)
    await send(page, 'Ask me E2E_ASK E2E_DELIVERY:inbox-bot')
    // A sidebar row can preview the same words; wait for the transcript's post.
    await page
      .getByRole('paragraph')
      .filter({ hasText: /^POSTED E2E_DELIVERY:inbox-bot$/ })
      .waitFor()
    // #4069: the question under the Bot details' "Needs your input" opens the Inbox
    // page on it, never a reply inside the panel.
    await setBotDetails(page, true)
    await page
      .getByRole('complementary', { name: 'Bot details' })
      .getByRole('button', { name: /Which marker should the fixture use\?/ })
      .click()
    await page
      .getByRole('heading', { level: 1, name: 'Which marker should the fixture use?' })
      .waitFor()
    await page.getByRole('tab', { name: /^Inbox/, selected: true }).waitFor({ timeout: 5_000 })
    await page.screenshot({ path: `${artifacts}/bot-details-question-inbox-light.png` })
    await page.getByRole('tab', { name: /^Inbox/ }).click()
    const source = page.locator('article header').getByRole('button', { name: 'E2E Bot' })

    await source.waitFor()
    await page.screenshot({ path: `${artifacts}/inbox-bot-source-light.png` })
    await source.click()
    // The Bot's chat, not its own session: only the chat's composer is headed by its name.
    await page.locator('[aria-placeholder="Message E2E Bot"]').waitFor()
    await page.getByRole('tab', { name: /^Bots/, selected: true }).waitFor({ timeout: 5_000 })
    await setBotDetails(page, false)
    // The sidebar slides over to Bots; shoot it once it has.
    await page.waitForTimeout(1_000)
    await page.screenshot({ path: `${artifacts}/inbox-bot-opened-light.png` })
    // #4065: a link in the Bot's question card opens in the dock, as in a Task's
    // chat, never in the system browser.
    await page.locator('[data-open-question] a[href$="/health/ready"]').last().click()
    const address = page.getByRole('textbox', { name: 'Search or enter URL' })

    await address.waitFor({ timeout: 10_000 })
    must(
      (await address.inputValue()).endsWith('/health/ready'),
      `the dock's browser to open the card's link, got ${await address.inputValue()}`,
    )
    await page.screenshot({ path: `${artifacts}/bot-question-link-dock-light.png` })
    await page.getByRole('button', { name: 'Close workspace panel' }).click()
    await page.getByRole('button', { name: 'E2E_DELIVERY:answered' }).last().click()
    await until('the answer in the Bot chat to reach the Bot', async () =>
      agentEvents(stack).includes('finish E2E_DELIVERY:answered'),
    )
  },
}

export default scenario
