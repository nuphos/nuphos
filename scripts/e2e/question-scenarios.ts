// Scenarios about what becomes of an agent's question, through the real routes.
import { agentEvents } from './agent-log.ts'
import { client, must } from './binding-access-scenarios.ts'
import { until } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Scenario } from './ui.ts'

type Listed = {
  conversations: { sessionId: string; firstMessage?: string; inputRequests?: Asked[] }[]
}
type Asked = { id: string; snoozedUntil?: string }

export const questionScenarios: Scenario[] = [
  {
    // #3231: Snooze sets a question aside without telling the agent; Dismiss tells it why.
    name: 'a snoozed question stays open and the agent is not told; a dismissal tells it why',
    run: async (page, stack) => {
      const owner = client(stack.apiUrl, stack.token)
      const asked = async () => {
        const listed = await owner(
          'GET',
          `/agent/conversations?teamId=${stack.teamId}&pendingDecision=true`,
        )
        const row = (listed.body as Listed).conversations.find((conversation) =>
          conversation.firstMessage?.includes('E2E_DELIVERY:snooze'),
        )

        return { sessionId: row?.sessionId ?? '', request: row?.inputRequests?.[0] }
      }
      const decide = (sessionId: string, id: string, path: string, body: unknown) =>
        owner(
          'POST',
          `/agent/conversations/${sessionId}/decisions/${id}/${path}?teamId=${stack.teamId}`,
          body,
        )

      await newTask(page)
      await send(page, 'Ask me E2E_ASK E2E_DELIVERY:snooze')
      await page.getByText('ACK E2E_DELIVERY:snooze').waitFor()
      const { sessionId, request } = await asked()

      must(Boolean(request), 'the question to be listed')
      const until1h = new Date(Date.now() + 3_600_000).toISOString()
      const turns = agentEvents(stack).length
      const snoozed = await decide(sessionId, request!.id, 'snooze', { until: until1h })

      must(
        snoozed.status === 200,
        `snooze to succeed, got ${String(snoozed.status)} ${snoozed.text}`,
      )
      must((await asked()).request?.snoozedUntil === until1h, 'the listing to carry snoozedUntil')
      await new Promise((resolve) => setTimeout(resolve, 2_000))
      must(agentEvents(stack).length === turns, 'a snooze to wake no agent')

      const dismissed = await decide(sessionId, request!.id, 'resolve', {
        resolution: 'dismissed',
        reason: 'E2E_DELIVERY:dismiss-reason',
      })

      must(dismissed.status === 200, `dismiss to succeed, got ${String(dismissed.status)}`)
      await until('the agent to be told its question was dismissed, and why', async () =>
        agentEvents(stack).includes('dismissed E2E_DELIVERY:dismiss-reason'),
      )
      await page.getByText(/was dismissed by .*: no answer is coming/).waitFor()
      must(!(await asked()).request, 'a dismissed question to leave the listing')
    },
  },
]
