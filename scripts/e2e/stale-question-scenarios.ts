// #3470: a question says when the agent last rewrote it, and leaves when the thread it is about is archived.
import { agentLog } from './agent-log.ts'
import { client, must } from './binding-access-scenarios.ts'
import { busyAnswerScenarios } from './busy-answer-scenarios.ts'
import { todoScenarios } from './todo-scenarios.ts'
import { calledTool } from './computer-scenarios.ts'
import { artifacts, until } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Scenario } from './ui.ts'

type Listed = { conversations: { inputRequests?: { id: string; updatedAt?: string }[] }[] }

const QUESTION = 'Keep the E2E about-kid thread running?'
const PLAN_QUESTION = 'Approve the E2E withdraw-kid plan?'

/** Every answer the fixture agent got from `name` through E2E_CALL, oldest first. */
const answers = (stack: Parameters<Scenario['run']>[1], name: string) =>
  agentLog(stack)
    .filter((entry) => entry.event === 'called' && entry.name === name)
    .map((entry) => JSON.stringify(entry.result))

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
  {
    // #3753: the conversation a question is about may withdraw it, though only its asker corrects it.
    name: 'the thread a question is about withdraws it from the Inbox; an unrelated thread cannot',
    run: async (page, stack) => {
      const owner = client(stack.apiUrl, stack.token)
      const open = async () => {
        const listed = await owner(
          'GET',
          `/agent/conversations?teamId=${stack.teamId}&pendingDecision=true`,
        )

        return (listed.body as Listed).conversations.flatMap((row) => row.inputRequests ?? [])
      }
      const threadIdOf = async () =>
        /threadId[\\": ]*([0-9a-f-]{36})/.exec(await calledTool(stack, 'create_thread'))?.[1]

      await newTask(page)
      await send(page, 'Plan the withdraw-kid work E2E_DELIVERY:withdraw-plan')
      await page.getByText('ACK E2E_DELIVERY:withdraw-plan').waitFor()
      const kid = {
        label: 'Start',
        title: 'E2E withdraw kid',
        prompt: 'Reply E2E_DELIVERY:withdraw-kid',
      }

      await callAndWait(page, 'create_thread', kid, 'withdraw-start')
      const kidId = await threadIdOf()

      must(Boolean(kidId), 'create_thread to return the kid threadId')
      const ask = {
        label: 'Ask',
        category: 'approval',
        question: PLAN_QUESTION,
        body: 'The kid thread runs the plan.',
        options: ['Approve', 'Reject'],
        about: [kidId],
      }

      await callAndWait(page, 'request_user_decision', ask, 'withdraw-ask')
      const requestId = /(nuphos-[0-9a-f-]{36})/.exec(
        await calledTool(stack, 'request_user_decision'),
      )?.[1]

      must(Boolean(requestId), 'request_user_decision to return a requestId')
      const withdraw = JSON.stringify({ label: 'Withdraw', requestId })
      const correct = JSON.stringify({
        label: 'Correct',
        requestId,
        question: 'Approve a new plan?',
      })
      const withdrawn = answers(stack, 'withdraw_user_decision').length
      const corrected = answers(stack, 'update_user_decision').length
      // A thread the question is not about tries first: it stays open.
      const other = {
        label: 'Start other',
        title: 'E2E unrelated kid',
        prompt: `Reply E2E_DELIVERY:withdraw-other\nE2E_CALL withdraw_user_decision ${withdraw}`,
      }

      await callAndWait(page, 'create_thread', other, 'withdraw-other-start')
      await until(
        'the unrelated thread to try withdrawing',
        async () => answers(stack, 'withdraw_user_decision').length > withdrawn,
      )
      must(
        answers(stack, 'withdraw_user_decision')[withdrawn]!.includes('No open question'),
        `an unrelated thread to be refused, got ${answers(stack, 'withdraw_user_decision')[withdrawn]}`,
      )
      must(
        (await open()).some((request) => request.id === requestId),
        'the question to stay open after the unrelated thread tried',
      )
      // The thread it is about cannot correct it, but withdraws it.
      const tell = {
        label: 'Tell kid',
        threadId: kidId,
        prompt: `Drop it E2E_DELIVERY:withdraw-kid-drop\nE2E_CALL update_user_decision ${correct}\nE2E_CALL withdraw_user_decision ${withdraw}`,
      }

      await callAndWait(page, 'send_message_to_thread', tell, 'withdraw-tell')
      await until(
        'the kid thread to withdraw it',
        async () => answers(stack, 'withdraw_user_decision').length > withdrawn + 1,
      )
      const update = answers(stack, 'update_user_decision')[corrected] ?? ''
      const kidWithdraw = answers(stack, 'withdraw_user_decision')[withdrawn + 1]!

      must(update.includes('No open question'), `the kid's correction to be refused, got ${update}`)
      must(kidWithdraw.includes('withdrawn'), `the kid to withdraw it, got ${kidWithdraw}`)
      await until('the withdrawn question to leave the Inbox', async () =>
        (await open()).every((request) => request.id !== requestId),
      )
      // The Inbox tab hides the composer, so it is opened only once the threads are done.
      await page.getByRole('tab', { name: 'Inbox' }).click()
      await page
        .locator('[data-inbox-question]', { hasText: PLAN_QUESTION })
        .waitFor({ state: 'detached' })
      await page.emulateMedia({ colorScheme: 'light' })
      await page.screenshot({ path: `${artifacts}/inbox-question-withdrawn-by-about-light.png` })
      await page.emulateMedia({ colorScheme: null })
    },
  },
  ...busyAnswerScenarios,
  ...todoScenarios,
]
