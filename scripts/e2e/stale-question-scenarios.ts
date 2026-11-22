// #3470: a question says when the agent last rewrote it, and leaves when the thread it is about is archived.
import { client, must } from './binding-access-scenarios.ts'
import { busyAnswerScenarios } from './busy-answer-scenarios.ts'
import { calledTool } from './computer-scenarios.ts'
import { artifacts, until } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Scenario } from './ui.ts'

type Listed = { conversations: { inputRequests?: { id: string; updatedAt?: string }[] }[] }

const QUESTION = 'Keep the E2E about-kid thread running?'

/** `name` called through E2E_CALL with `args`; waits for the turn marked `marker` to end. */
async function callAndWait(
  page: Parameters<Scenario['run']>[0],
  name: string,
  args: Record<string, unknown>,
  marker: string,
) {
  await send(page, `Do it E2E_CALL ${name} ${JSON.stringify(args)} E2E_DELIVERY:${marker}`)
  await page.getByText(`ACK E2E_DELIVERY:${marker}`).waitFor()
}

export const staleQuestionScenarios: Scenario[] = [
  {
    name: 'an edited question says so in the Inbox, and leaves once the thread it is about is archived',
    run: async (page, stack) => {
      const owner = client(stack.apiUrl, stack.token)
      const open = async () => {
        const listed = await owner(
          'GET',
          `/agent/conversations?teamId=${stack.teamId}&pendingDecision=true`,
        )

        return (listed.body as Listed).conversations.flatMap((row) => row.inputRequests ?? [])
      }

      await newTask(page)
      // A thread's prompt names its parent by title, the first message: keep E2E_CALL out of it,
      // or the thread would run the parent's escaped call too.
      await send(page, 'Plan the about-kid work E2E_DELIVERY:about-plan')
      await page.getByText('ACK E2E_DELIVERY:about-plan').waitFor()
      const start = {
        label: 'Start',
        title: 'E2E about kid',
        prompt: 'Reply E2E_DELIVERY:about-kid',
      }

      await callAndWait(page, 'create_thread', start, 'about-start')
      const threadId = /threadId[\\": ]*([0-9a-f-]{36})/.exec(
        await calledTool(stack, 'create_thread'),
      )?.[1]

      must(Boolean(threadId), 'create_thread to return a threadId')
      const ask = {
        label: 'Ask',
        category: 'preference',
        question: QUESTION,
        body: 'It has not reported yet.',
        options: ['Keep', 'Stop'],
        about: [threadId],
      }

      await callAndWait(page, 'request_user_decision', ask, 'about-ask')
      // The tool's text pretty-prints its JSON (`"requestId": "nuphos-…"`): match the id itself.
      const requestId = /(nuphos-[0-9a-f-]{36})/.exec(
        await calledTool(stack, 'request_user_decision'),
      )?.[1]

      must(Boolean(requestId), 'request_user_decision to return a requestId')
      const correct = { label: 'Correct', requestId, body: 'It finished half of the work.' }

      await callAndWait(page, 'update_user_decision', correct, 'about-edit')
      const edited = (await open()).find((request) => request.id === requestId)

      must(Boolean(edited?.updatedAt), `the edit to be stamped, got ${JSON.stringify(edited)}`)

      await page.getByRole('tab', { name: 'Inbox' }).click()
      await page.locator('[data-inbox-question]', { hasText: QUESTION }).click()
      await page
        .getByText(/^Edited /)
        .first()
        .waitFor()
      await page.emulateMedia({ colorScheme: 'light' })
      await page.screenshot({ path: `${artifacts}/inbox-question-edited-light.png` })
      await page.emulateMedia({ colorScheme: null })

      // Archived the way the app's Archive action does it.
      const archived = await owner('PATCH', `/agent/conversations/${String(threadId)}/archive`, {
        teamId: stack.teamId,
        archived: true,
      })

      must(archived.status === 200, `the thread to be archived, got ${archived.text}`)
      await until('the question about the archived thread to leave the Inbox', async () =>
        (await open()).every((request) => request.id !== requestId),
      )
    },
  },
  ...busyAnswerScenarios,
]
