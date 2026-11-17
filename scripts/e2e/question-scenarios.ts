// Scenarios about what becomes of an agent's question, through the real routes.
import { agentEvents, agentLog } from './agent-log.ts'
import { backendLines, backendLog } from './backend-log.ts'
import { client, must } from './binding-access-scenarios.ts'
import { artifacts, until } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

type Listed = {
  conversations: { sessionId: string; firstMessage?: string; inputRequests?: Asked[] }[]
}
type Asked = { id: string; snoozedUntil?: string }

const light = (page: Page) =>
  page.evaluate(() => {
    document.documentElement.classList.remove('dark')
    document.documentElement.classList.add('light')
  })

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
  {
    // #3265: an answer given while the agent host was away reopened its question as "did not
    // run", though the answer was kept in the conversation, so it was both delivered and open.
    name: 'an answer given while the agent host is away reaches it once back, and its question stays answered',
    run: async (page, stack) => {
      const owner = client(stack.apiUrl, stack.token)

      await newTask(page)
      await send(page, 'Ask me E2E_ASK E2E_DELIVERY:away-ask')
      await page.getByText('ACK E2E_DELIVERY:away-ask').waitFor()
      const sessionId = agentLog(stack).find(
        (entry) => entry.marker === 'E2E_DELIVERY:away-ask',
      )?.sessionId
      const answered = () =>
        agentLog(stack).filter(
          (entry) =>
            entry.sessionId === sessionId &&
            entry.event === 'start' &&
            entry.marker === 'E2E_DELIVERY:answered',
        ).length

      await stack.restartAgentHost(async () => {
        const from = backendLines()

        await page.getByRole('button', { name: 'E2E_DELIVERY:answered' }).last().click()
        await until('the answer to be taken', async () =>
          backendLog(from).some(
            (line) => line.includes('/answer') && line.includes('"status":200'),
          ),
        )
        // The turn it wakes finds the host away well within this.
        await page.waitForTimeout(5_000)
      })
      const reached = await page
        .getByText('ACK E2E_DELIVERY:answered')
        .waitFor({ timeout: 90_000 })
        .then(
          () => true,
          () => false,
        )

      await page.reload()
      await light(page)
      await page.waitForTimeout(2_000)
      await page.screenshot({ path: `${artifacts}/question-answered-while-away-light.png` })
      must(reached, 'the answer to reach the agent once its host was back')
      must(
        (await page.getByText(/did not run/).count()) === 0,
        'no "did not run" question in the chat',
      )
      must(
        (await page
          .getByRole('heading', { name: 'Which marker should the fixture use?' })
          .count()) === 0,
        'no open question card, only the answered line',
      )
      const listed = await owner(
        'GET',
        `/agent/conversations?teamId=${stack.teamId}&pendingDecision=true`,
      )
      const open = (listed.body as Listed).conversations.find(
        (conversation) => conversation.sessionId === sessionId,
      )?.inputRequests

      must(!open?.length, `no open question in the Inbox, got ${JSON.stringify(open)}`)
      // Long enough for a second delivery to have started, had there been one.
      await page.waitForTimeout(3_000)
      must(answered() === 1, `the answer to reach the agent once, got ${String(answered())}`)
    },
  },
]
