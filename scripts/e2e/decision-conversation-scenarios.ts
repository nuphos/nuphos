// #3752: a question says which conversations receive the answer, in the chat and the Inbox.
import { client, must } from './binding-access-scenarios.ts'
import { artifacts, until } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Scenario } from './ui.ts'

export const decisionConversationScenarios: Scenario[] = [
  {
    name: 'decision cards name the conversations that will act on the answer',
    run: async (page, stack) => {
      const api = client(stack.apiUrl, stack.token)
      const worker = async (name: string, marker: string) => {
        await newTask(page)
        await send(page, `Prepare release notes E2E_DELIVERY:${marker}`)
        await page.getByText(`ACK E2E_DELIVERY:${marker}`).waitFor()
        const listed = await api(
          'GET',
          `/agent/conversations?teamId=${stack.teamId}&search=${marker}`,
        )
        const conversation = (listed.body as { conversations: { sessionId: string }[] })
          .conversations[0]!

        must(Boolean(conversation), `a conversation for ${marker}`)
        const renamed = await api('PATCH', `/agent/conversations/${conversation.sessionId}/title`, {
          title: name,
          teamId: stack.teamId,
        })

        must(renamed.status === 200, `rename ${name}`)

        return conversation.sessionId
      }
      const first = await worker('Release writer', 'recipient-writer')
      const second = await worker(
        'Release checker for documentation and deployment notes with an intentionally long conversation title',
        'recipient-checker',
      )

      await newTask(page)
      const args = {
        label: 'Ask about the release',
        category: 'approval',
        question: 'Publish the release notes?',
        body: 'The writer and checker will receive this answer. Both drafts use fictional data.',
        options: ['Publish', 'Keep reviewing'],
        about: [first, second],
      }

      await send(
        page,
        `Ask it E2E_CALL request_user_decision ${JSON.stringify(args)} E2E_DELIVERY:recipients`,
      )
      await page.getByText('ACK E2E_DELIVERY:recipients').waitFor()
      const recipients = page.locator('[data-decision-conversations]').last()

      await recipients.getByRole('link', { name: 'Release writer' }).waitFor()
      await recipients
        .getByRole('link', {
          name: 'Release checker for documentation and deployment notes with an intentionally long conversation title',
        })
        .waitFor()
      await page.screenshot({ path: `${artifacts}/decision-conversations-chat.png` })
      await page.getByRole('tab', { name: 'Inbox' }).click()
      await page.locator('[data-inbox-question]', { hasText: 'Publish the release notes?' }).click()
      await page.getByRole('heading', { level: 1, name: 'Publish the release notes?' }).waitFor()
      await recipients.getByRole('link', { name: 'Release writer' }).waitFor()
      await page.screenshot({ path: `${artifacts}/decision-conversations-inbox.png` })
      await recipients.getByRole('link', { name: 'Release writer' }).click()
      await page.getByText('ACK E2E_DELIVERY:recipient-writer').waitFor()
      await page.getByRole('tab', { name: 'Inbox' }).click()
      await page.locator('[data-inbox-question]', { hasText: 'Publish the release notes?' }).click()
      await page.getByRole('heading', { level: 1, name: 'Publish the release notes?' }).waitFor()
      // Read the real route too: list and detail must agree on exactly the same recipients.
      const listed = await api(
        'GET',
        `/agent/conversations?teamId=${stack.teamId}&pendingDecision=true`,
      )
      const rows = (
        listed.body as {
          conversations: {
            sessionId: string
            inputRequests?: { question: string; aboutConversations?: unknown[] }[]
          }[]
        }
      ).conversations
      const source = rows.find((row) =>
        row.inputRequests?.some((request) => request.question === args.question),
      )!
      const detail = await api(
        'GET',
        `/agent/conversations/${source.sessionId}?teamId=${stack.teamId}&messages=omit&runtimeState=omit`,
      )
      const request = (detail.body as typeof source).inputRequests?.find(
        (item) => item.question === args.question,
      )

      must(
        JSON.stringify(request?.aboutConversations) ===
          JSON.stringify([
            { sessionId: first, title: 'Release writer' },
            {
              sessionId: second,
              title:
                'Release checker for documentation and deployment notes with an intentionally long conversation title',
            },
          ]),
        'the detail to expose the real, readable recipients',
      )
      await page.getByRole('button', { name: 'Publish', exact: true }).click()
      await until('the question to close', async () => {
        const response = await api(
          'GET',
          `/agent/conversations/${source.sessionId}?teamId=${stack.teamId}&messages=omit&runtimeState=omit`,
        )

        return !(response.body as typeof source).inputRequests?.some(
          (item) => item.question === args.question,
        )
      })
    },
  },
]
