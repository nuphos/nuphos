// #3548: an answer given in the Inbox shows in the Bot chat as the answerer's reply to the
// question, quoted inside their bubble, and wakes the Bot no more than the answer itself does.
import { agentEvents, agentLog } from '../agent-log.ts'
import { client } from '../binding-access-scenarios.ts'
import { nameViewer, openBotChat, shoot } from '../channel-quotes.ts'
import { until } from '../processes.ts'
import { send, transcriptPost } from '../ui.ts'

import type { Stack } from '../stack.ts'
import type { Scenario } from '../ui.ts'

const QUESTION = 'Which marker should the fixture use?'
const ANSWER = 'E2E_DELIVERY:answered'

const count = (stack: Stack, event: string) =>
  agentEvents(stack).filter((entry) => entry === event).length
const channelWakes = (stack: Stack) =>
  agentLog(stack).filter((entry) => entry.event === 'channel').length

const scenario: Scenario = {
  name: "an answer given in the Inbox is the answerer's reply in the Bot chat, quoted in the bubble",
  run: async (page, stack) => {
    await nameViewer(stack, 'Alex Rivera')
    await openBotChat(page)
    await send(page, 'Ask me E2E_ASK E2E_DELIVERY:inbox-reply')
    await transcriptPost(page, 'POSTED E2E_DELIVERY:inbox-reply').waitFor()
    const wakes = channelWakes(stack)
    const answered = count(stack, `finish ${ANSWER}`)
    // The question it just asked, the Bot's only open one: the scenarios before answered theirs.
    const listed = (
      await client(stack.apiUrl, stack.token)(
        'GET',
        `/agent/conversations?teamId=${stack.teamId}&pendingDecision=true&bots=true`,
      )
    ).body as { conversations: { title?: string; inputRequests?: { id: string }[] }[] }
    const asked = listed.conversations.find((row) => row.title === 'E2E Bot')?.inputRequests?.at(-1)

    if (!asked)
      throw new Error(`The Bot's question is not open: ${JSON.stringify(listed).slice(0, 2000)}`)
    await page.getByRole('tab', { name: /^Inbox/ }).click()
    await page.locator(`[data-inbox-question="${asked.id}"]`).click()
    await page.getByRole('button', { name: ANSWER }).last().click()
    await until(
      'the answer to reach the Bot',
      async () => count(stack, `finish ${ANSWER}`) > answered,
    )

    await openBotChat(page)
    // The chat in front: a Bot chat stays mounted, inert, behind other pages.
    const answers = page.locator('.group\\/post:not([inert] *)', { hasText: ANSWER })
    const post = answers.last()
    const bubble = post.locator('.user-message-bubble')

    // The quote is the bubble's first line: the Bot's name, then its question.
    await bubble.getByRole('button', { name: new RegExp(`^E2E Bot\\s*${QUESTION}`) }).waitFor()
    await post.getByText('Answered in Inbox', { exact: true }).waitFor()
    const asking = page.locator('.group\\/post:not([inert] *)', {
      hasText: 'POSTED E2E_DELIVERY:inbox-reply',
    })

    if ((await post.boundingBox())!.y < (await asking.last().boundingBox())!.y)
      throw new Error('No answer post came after the question was asked')
    // Answers given on their card in the chat, by the scenarios before, say nothing of the Inbox.
    for (const earlier of (await answers.all()).slice(0, -1))
      if ((await earlier.getByText('Answered in Inbox').count()) > 0)
        throw new Error('An answer given on its card in the chat says "Answered in Inbox"')
    if ((await page.locator('[data-decision-record]').count()) > 0)
      throw new Error('An answer left the old "answered:" line instead of a post')

    // The posts were written, not posted: no channel notice woke the Bot for them.
    await page.waitForTimeout(3_000)
    if (channelWakes(stack) !== wakes)
      throw new Error(`The answer's posts woke the Bot: ${String(channelWakes(stack) - wakes)}`)

    await post.scrollIntoViewIfNeeded()
    const themed = await page.evaluate(() => document.documentElement.className)

    await shoot(page, 'inbox-answer')
    // Replying to the answer: the bar names it and quotes it on two lines.
    await post.hover()
    await post.getByRole('button', { name: 'Reply', exact: true }).click()
    await page
      .getByText(/^Replying to /)
      .last()
      .waitFor()
    await shoot(page, 'inbox-answer-replying')
    await page.getByRole('button', { name: 'Cancel reply' }).click()
    await page.evaluate((themed) => {
      document.documentElement.className = themed
    }, themed)
  },
}

export default scenario
