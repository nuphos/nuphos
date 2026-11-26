// #4147: a Bot out of Full Access, woken by its chat, reads and answers there without
// asking. #5133: a post to any other channel asks the owner in that chat, and a Deny
// there lets the turn go on with the refusal instead of ending it.
import { agentLog } from '../agent-log.ts'
import { client } from '../binding-access-scenarios.ts'
import { openBotChat } from '../channel-quotes.ts'
import { artifacts, until } from '../processes.ts'

import type { Scenario } from '../ui.ts'

const MARKER = 'E2E_DELIVERY:ask-tools'

const scenario: Scenario = {
  name: 'a Bot woken by its chat answers there without asking, and asks its owner there before posting elsewhere',
  run: async (page, stack) => {
    const api = client(stack.apiUrl, stack.token)
    const bots = await api('GET', `/agent/conversations?teamId=${stack.teamId}&bots=true`)
    const bot = (
      bots.body as { conversations: { sessionId: string; title?: string }[] }
    ).conversations.find((row) => row.title === 'E2E Bot')

    // The chat the Bot answered in before, as "a Bot's answer to the newest post does not quote it" posts to.
    const channelId = agentLog(stack).find((entry) => entry.event === 'channel')?.detail

    if (!bot || !channelId) throw new Error('No E2E Bot that has answered in its chat')
    const before = await api('GET', `/agent/auto-mode/bypass?sessionId=${bot.sessionId}`)
    const fullAccess = (before.body as { bypass: boolean }).bypass

    await api('PUT', '/agent/auto-mode/bypass', { sessionId: bot.sessionId, bypass: false })
    try {
      await openBotChat(page)
      const posted = await fetch(
        `${stack.apiUrl}/agent/conversations/${channelId}/channel-messages`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${stack.token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ teamId: stack.teamId, text: `Hello ${MARKER}` }),
        },
      )

      if (!posted.ok) throw new Error(`Posting failed: ${String(posted.status)}`)
      const answered = (tool: string) =>
        agentLog(stack).find(
          (entry) =>
            entry.marker === MARKER &&
            entry.detail === `mcp__nuphos-tools__${tool}` &&
            entry.event !== 'permission-asked',
        )

      const posts = () =>
        agentLog(stack).filter(
          (entry) =>
            entry.marker === MARKER &&
            entry.detail === 'mcp__nuphos-tools__channel_post' &&
            entry.event !== 'permission-asked',
        )
      // Only the tool approval: an earlier scenario's question card may still be open.
      const card = page.locator('[data-tool-approval]').filter({ visible: true })

      // The owner is asked in the chat itself, and denies.
      await card.getByRole('button', { name: 'Deny' }).waitFor()
      await page.emulateMedia({ colorScheme: 'light' })
      await page.screenshot({ path: `${artifacts}/bot-chat-tool-approval-light.png` })
      await page.emulateMedia({ colorScheme: null })
      await card.getByRole('button', { name: 'Deny' }).click()
      await until('the denied post to be answered', async () => posts().length >= 2)
      const [ownPost, elsewhere] = posts()

      if (answered('channel_read')?.event !== 'permission-allow')
        throw new Error(`channel_read was not allowed: ${JSON.stringify(answered('channel_read'))}`)
      if (ownPost?.event !== 'permission-allow')
        throw new Error(`The answer to its own chat was not allowed: ${JSON.stringify(ownPost)}`)
      // A reject, not a cancel: the turn goes on and can still say it was not run.
      if (elsewhere?.event !== 'permission-reject')
        throw new Error(`The denied post was not rejected: ${JSON.stringify(elsewhere)}`)
      await page.getByText(`POSTED ${MARKER}`).filter({ visible: true }).first().waitFor()
      await card.waitFor({ state: 'detached' })
      await page.emulateMedia({ colorScheme: 'light' })
      await page.screenshot({ path: `${artifacts}/bot-chat-tool-approval-denied-light.png` })
      await page.emulateMedia({ colorScheme: null })
    } finally {
      await api('PUT', '/agent/auto-mode/bypass', { sessionId: bot.sessionId, bypass: fullAccess })
    }
  },
}

export default scenario
