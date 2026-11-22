// A Trigger's turn in a Bot failed while its chat ends with a good post. The Bot's row kept
// saying "Failed" in place of that post, though the chat showed nothing wrong. The row keeps
// the newest post and its alert mark; the next turn, which goes through, clears the mark.
import { agentEvents } from '../agent-log.ts'
import { client } from '../binding-access-scenarios.ts'
import { openBotChat } from '../channel-quotes.ts'
import { artifacts, until } from '../processes.ts'
import { send, transcriptPost } from '../ui.ts'

import type { Scenario } from '../ui.ts'

const BEFORE = 'E2E_DELIVERY:before-failure'
const FAILED = 'E2E_DELIVERY:trigger-failed'
const AFTER = 'E2E_DELIVERY:after-failure'

const scenario: Scenario = {
  name: "a Bot whose Trigger turn failed keeps its chat's newest post in its row",
  run: async (page, stack) => {
    const api = client(stack.apiUrl, stack.token)
    const { conversations } = (
      await api('GET', `/agent/conversations?teamId=${stack.teamId}&bots=true`)
    ).body as { conversations: { sessionId: string; title?: string }[] }
    const bot = conversations.find((row) => row.title === 'E2E Bot')

    if (!bot) throw new Error(`No E2E Bot: ${JSON.stringify(conversations)}`)
    await openBotChat(page)
    await send(page, `Post this ${BEFORE}`)
    await transcriptPost(page, `POSTED ${BEFORE}`).waitFor()
    const row = page.locator('[data-sidebar-row]').filter({ hasText: 'E2E Bot' }).first()
    const alert = row.locator('svg.lucide-circle-alert')

    await row.getByText(`POSTED ${BEFORE}`).waitFor()
    // An unattended turn in the Bot's own session, as an hourly Trigger runs it.
    const trigger = (
      await api('POST', '/agent/triggers', {
        teamId: stack.teamId,
        targetSessionId: bot.sessionId,
        name: 'Hourly check',
        triggerType: 'cron',
        cronExpression: '0 * * * *',
        messageTemplate: `Check E2E_FAIL_ONCE ${FAILED}`,
      })
    ).body as { id: string }

    await api('POST', `/agent/triggers/${trigger.id}/test-fire?teamId=${stack.teamId}`)
    await until('the Trigger turn to reach the Bot', async () =>
      agentEvents(stack).includes(`start ${FAILED}`),
    )
    await alert.waitFor()
    await page.evaluate(() => {
      document.documentElement.classList.remove('dark')
      document.documentElement.classList.add('light')
    })
    await page.waitForTimeout(500)
    // Shot before the checks, so a run without the fix shows what it got.
    await row.screenshot({ path: `${artifacts}/bot-failed-turn-row-light.png` })
    await page.screenshot({ path: `${artifacts}/bot-failed-turn-light.png` })
    if ((await row.getByText('Failed', { exact: true }).count()) > 0)
      throw new Error('"Failed" took the place of the chat\'s newest post')
    await row.getByText(`POSTED ${BEFORE}`).waitFor()

    // The next turn goes through: its post is the preview, and the alert mark is gone.
    await send(page, `Post this ${AFTER}`)
    await transcriptPost(page, `POSTED ${AFTER}`).waitFor()
    await row.getByText(`POSTED ${AFTER}`).waitFor()
    await alert.waitFor({ state: 'detached' })
    await page.waitForTimeout(500)
    await row.screenshot({ path: `${artifacts}/bot-failed-then-ok-row-light.png` })
    await api('DELETE', `/agent/triggers/${trigger.id}?teamId=${stack.teamId}`)
  },
}

export default scenario
