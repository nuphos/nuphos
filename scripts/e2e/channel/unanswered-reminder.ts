// #5162: a Bot whose chat-woken turn ends without channel_post is woken once more to answer
// there, and only once. The fixture agent stays silent on the first wake of this post.
import { agentLog } from '../agent-log.ts'
import { openBotChat } from '../channel-quotes.ts'
import { artifacts } from '../processes.ts'
import { transcriptPost } from '../ui.ts'

import type { Scenario } from '../ui.ts'

const MARKER = 'E2E_DELIVERY:silent-once'

const scenario: Scenario = {
  name: 'a Bot that ends its turn without answering its chat is woken once more to answer there',
  run: async (page, stack) => {
    const channelId = agentLog(stack).find((entry) => entry.event === 'channel')?.detail

    if (!channelId) throw new Error('No E2E Bot that has answered in its chat')
    await openBotChat(page)
    const posted = await fetch(
      `${stack.apiUrl}/agent/conversations/${channelId}/channel-messages`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${stack.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ teamId: stack.teamId, text: `Is the deploy done? ${MARKER}` }),
      },
    )

    if (!posted.ok) throw new Error(`Posting failed: ${String(posted.status)}`)
    await transcriptPost(page, `POSTED ${MARKER}`).waitFor({ timeout: 90_000 })
    await page.screenshot({ path: `${artifacts}/unanswered-reminder.png` })
    // Answered now: nothing wakes it for this post again.
    await page.waitForTimeout(5_000)
    const silent = agentLog(stack).filter(
      (entry) => entry.marker === MARKER && entry.event === 'channel-silent',
    )

    if (silent.length !== 1)
      throw new Error(`Expected one silent turn first, got ${String(silent.length)}`)
    if ((await transcriptPost(page, `POSTED ${MARKER}`).count()) !== 1)
      throw new Error('The Bot answered the post more than once')
  },
}

export default scenario
