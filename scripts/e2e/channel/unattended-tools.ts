// #4147: a Bot out of Full Access, woken by its chat, reads and answers there without
// asking, and a post to any other channel fails at once instead of waiting for nobody.
import { agentLog } from '../agent-log.ts'
import { client } from '../binding-access-scenarios.ts'
import { openBotChat } from '../channel-quotes.ts'
import { until } from '../processes.ts'

import type { Scenario } from '../ui.ts'

const MARKER = 'E2E_DELIVERY:ask-tools'

const scenario: Scenario = {
  name: 'a Bot woken by its chat reads and answers there without asking, and fails elsewhere at once',
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

      await until('the Bot to try a post in another channel', async () => {
        const all = agentLog(stack).filter(
          (entry) => entry.marker === MARKER && entry.detail === 'mcp__nuphos-tools__channel_post',
        )

        return all.length >= 2
      })
      const [ownPost, elsewhere] = agentLog(stack).filter(
        (entry) => entry.marker === MARKER && entry.detail === 'mcp__nuphos-tools__channel_post',
      )

      if (answered('channel_read')?.event !== 'permission-allow')
        throw new Error(`channel_read was not allowed: ${JSON.stringify(answered('channel_read'))}`)
      if (ownPost?.event !== 'permission-allow')
        throw new Error(`The answer to its own chat was not allowed: ${JSON.stringify(ownPost)}`)
      if (elsewhere?.event !== 'permission-cancelled' || (elsewhere.ms ?? Infinity) > 10_000)
        throw new Error(`A post elsewhere did not fail at once: ${JSON.stringify(elsewhere)}`)
      await page.getByText(`POSTED ${MARKER}`).filter({ visible: true }).first().waitFor()
      if ((await page.getByRole('button', { name: /^Allow/ }).count()) > 0)
        throw new Error('An approval was shown for a turn nobody was asked about')
    } finally {
      await api('PUT', '/agent/auto-mode/bypass', { sessionId: bot.sessionId, bypass: fullAccess })
    }
  },
}

export default scenario
