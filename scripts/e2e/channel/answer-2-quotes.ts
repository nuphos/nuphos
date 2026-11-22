// #3548: a teammate's reply in the Bot chat and a Slack reply in a Task quote their post
// inside the bubble too, on the other bubble's tint.
import { agentLog } from '../agent-log.ts'
import { client } from '../binding-access-scenarios.ts'
import { QUOTED, nameViewer, openBotChat, shoot, store } from '../channel-quotes.ts'
import { newTask, send } from '../ui.ts'

import type { Scenario } from '../ui.ts'

const scenario: Scenario = {
  name: "a teammate's reply and a Slack reply quote their post inside the bubble",
  run: async (page, stack) => {
    const themed = await page.evaluate(() => document.documentElement.className)
    const channelId = agentLog(stack).find((entry) => entry.event === 'channel')?.detail

    if (!channelId) throw new Error('The Bot has not answered in its chat yet')
    store(
      stack,
      channelId,
      'e2e-teammate-reply',
      {
        version: 1,
        source: 'nuphos',
        sender: { type: 'user', id: 'e2e-teammate', displayName: 'Mei Chen' },
        replyTo: { authorName: 'E2E Bot', text: QUOTED },
      },
      'The standard one is fine; legal only needs the ones with edits.',
    )
    // Stored behind the app's back: a reload reads it as a later visit would.
    await page.reload()
    await openBotChat(page)
    await page
      .getByText(/^The standard one is fine/)
      .first()
      .waitFor()
    await shoot(page, 'teammate-reply')

    // A Slack reply in a Task: the same quote, in your own bubble.
    await newTask(page)
    await send(page, 'Quote host E2E_DELIVERY:quote-host')
    await page.getByText('ACK E2E_DELIVERY:quote-host').waitFor()
    const { conversations } = (
      await client(stack.apiUrl, stack.token)(
        'GET',
        `/agent/conversations?teamId=${stack.teamId}&search=E2E_DELIVERY%3Aquote-host`,
      )
    ).body as { conversations: { sessionId: string }[] }
    const task = conversations[0]?.sessionId

    if (!task) throw new Error('The quote host Task was not listed')
    store(
      stack,
      task,
      'e2e-slack-reply',
      {
        version: 1,
        source: 'slack',
        sender: { type: 'user', id: 'slack:U0E2E', displayName: 'Can' },
        replyTo: { authorName: 'Mei Chen', text: QUOTED },
      },
      'Send the standard DPA today and flag any edits to legal.',
    )
    await newTask(page)
    await page
      .getByText('Quote host E2E_DELIVERY:quote-host', { exact: true })
      .filter({ visible: true })
      .first()
      .click()
    await page
      .getByText(/^Send the standard DPA today/)
      .first()
      .waitFor()
    await shoot(page, 'slack-reply')
    await page.evaluate((themed) => {
      document.documentElement.className = themed
    }, themed)
    await page.evaluate((themed) => {
      document.documentElement.className = themed
    }, themed)
    await nameViewer(stack)
  },
}

export default scenario
