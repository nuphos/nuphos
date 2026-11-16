// Scenarios about a Bot reading its chat. They run in the Bot chat the scenario before opened.
import { agentLog } from './agent-log.ts'

import type { Scenario } from './ui.ts'

export const channelScenarios: Scenario[] = [
  {
    // #2949: channel_read in a woken turn returned the page the notice had shown, not the rest.
    name: 'a Bot woken by more than a page of posts reads on to the newest one',
    run: async (page, stack) => {
      const channelId = agentLog(stack).find((entry) => entry.event === 'channel')?.detail
      const post = async (text: string) => {
        const response = await fetch(
          `${stack.apiUrl}/agent/conversations/${channelId ?? ''}/channel-messages`,
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${stack.token}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({ teamId: stack.teamId, text }),
          },
        )

        if (!response.ok) throw new Error(`Posting failed: ${String(response.status)}`)
      }

      if (!channelId) throw new Error('The Bot has not answered in its chat yet')
      // The first keeps the Bot busy, so the next 52 wait for one notice of more than a page.
      await post('Hold on E2E_SLOW E2E_DELIVERY:slow')
      for (let n = 0; n < 51; n++) await post(`Burst ${String(n)}`)
      await post('The newest E2E_DELIVERY:newest')
      // The Bot posts only once it has read on, so any repeat is logged by now.
      await page.getByText('POSTED E2E_DELIVERY:newest', { exact: true }).waitFor()
      const repeats = agentLog(stack).filter((entry) => entry.event === 'channel-repeat')

      if (repeats.length > 0) {
        throw new Error(
          `channel_read returned posts the notice had shown: ${JSON.stringify(repeats)}`,
        )
      }
    },
  },
]
