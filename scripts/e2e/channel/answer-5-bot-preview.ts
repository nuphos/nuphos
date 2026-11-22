// #4508: a Bot's row previews its chat's newest post on up to two lines, and an open question
// stays in the Inbox rather than taking the preview's place.
import { agentEvents, agentLog } from '../agent-log.ts'
import { openBotChat, store } from '../channel-quotes.ts'
import { artifacts, until } from '../processes.ts'
import { send, transcriptPost } from '../ui.ts'

import type { Scenario } from '../ui.ts'

const ANSWER = 'E2E_DELIVERY:answered'
const LONG =
  'Moved the staging rollout to Thursday so the database migration can finish first, and asked the on-call team to watch the error rate after it ships.'

const scenario: Scenario = {
  name: "a Bot's row previews its newest post on two lines, without its open question",
  run: async (page, stack) => {
    await openBotChat(page)
    await send(page, 'Ask me E2E_ASK E2E_DELIVERY:bot-preview')
    await transcriptPost(page, 'POSTED E2E_DELIVERY:bot-preview').waitFor()
    const channelId = agentLog(stack).find((entry) => entry.event === 'channel')?.detail

    if (!channelId) throw new Error('The Bot has not answered in its chat yet')
    store(
      stack,
      channelId,
      'e2e-bot-preview',
      {
        version: 1,
        source: 'nuphos',
        sender: { type: 'user', id: 'e2e-teammate', displayName: 'Mei Chen' },
      },
      LONG,
    )
    // Stored behind the app's back: a reload reads it as a later visit would.
    await page.reload()
    await openBotChat(page)
    const row = page.locator('[data-sidebar-row]').filter({ hasText: 'E2E Bot' }).first()
    const preview = row.getByText(/Moved the staging rollout/)

    await preview.waitFor()
    await page.evaluate(() => {
      document.documentElement.classList.remove('dark')
      document.documentElement.classList.add('light')
    })
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${artifacts}/bot-preview-two-lines-light.png` })

    if ((await row.getByText(/Needs your input/).count()) > 0)
      throw new Error("The Bot's open question took over its preview")
    const { height, line } = await preview.evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      line: Number.parseFloat(getComputedStyle(element).lineHeight),
    }))

    if (Math.round(height / line) !== 2)
      throw new Error(`The preview is ${String(height)}px, not two ${String(line)}px lines`)

    // Answered, so the scenarios that follow find no question of this one open.
    const answered = agentEvents(stack).filter((entry) => entry === `finish ${ANSWER}`).length

    await page.getByRole('button', { name: ANSWER }).last().click()
    await until(
      'the answer to reach the Bot',
      async () =>
        agentEvents(stack).filter((entry) => entry === `finish ${ANSWER}`).length > answered,
    )
  },
}

export default scenario
