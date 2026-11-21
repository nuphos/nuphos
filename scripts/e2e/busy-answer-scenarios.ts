// #4175: a question answered while its agent's turn runs reaches the agent through its tools,
// so it is not asked again.
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { agentLog } from './agent-log.ts'
import { client, must } from './binding-access-scenarios.ts'
import { artifacts, until } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Scenario } from './ui.ts'

type Listed = { conversations: { sessionId: string; inputRequests?: { id: string }[] }[] }

const QUESTION = 'Post the E2E draft to the partner channel?'

export const busyAnswerScenarios: Scenario[] = [
  {
    name: "a question answered while the agent's turn runs is given to it, and it does not ask again",
    run: async (page, stack) => {
      const owner = client(stack.apiUrl, stack.token)
      const release = join(artifacts, 'release')
      const calls = (name: string) =>
        agentLog(stack).filter((entry) => entry.event === 'called' && entry.name === name)
      const asked = calls('request_user_decision').length
      const ask = {
        label: 'Ask',
        category: 'approval',
        question: QUESTION,
        body: 'The draft is ready.',
        options: ['Post', 'Wait'],
      }

      rmSync(release, { force: true })
      try {
        await newTask(page)
        // The turn asks, then keeps working until the scenario releases it.
        await send(
          page,
          `Ask and keep working E2E_CALL request_user_decision ${JSON.stringify(ask)} E2E_WAIT_RELEASE E2E_RECHECK E2E_DELIVERY:busy-answer`,
        )
        let requestId = ''
        let sessionId = ''

        await until('the question to be open', async () => {
          requestId =
            /(nuphos-[0-9a-f-]{36})/.exec(
              JSON.stringify(calls('request_user_decision')[asked]),
            )?.[1] ?? ''
          const listed = await owner(
            'GET',
            `/agent/conversations?teamId=${stack.teamId}&pendingDecision=true`,
          )

          sessionId =
            (listed.body as Listed).conversations.find((entry) =>
              entry.inputRequests?.some((request) => request.id === requestId),
            )?.sessionId ?? ''

          return Boolean(requestId && sessionId)
        })
        // Answered as the iOS and Desktop cards answer, while the turn still runs.
        const answered = await owner(
          'POST',
          `/agent/conversations/${sessionId}/decisions/${requestId}/answer?teamId=${stack.teamId}`,
          { choices: ['Post'] },
        )

        must(answered.status === 200, `the answer to be taken, got ${answered.text}`)
        writeFileSync(release, '')
        await until('the agent to look at its question again', async () =>
          calls('withdraw_user_decision').some((entry) =>
            JSON.stringify(entry.result).includes(requestId),
          ),
        )
        const said = (name: string) => JSON.stringify(calls(name).at(-1)?.result)

        for (const name of [
          'list_user_decisions',
          'update_user_decision',
          'withdraw_user_decision',
        ]) {
          const result = said(name)

          writeFileSync(join(artifacts, `busy-answer-${name}.json`), result)
          must(
            result.includes(requestId) && result.includes('Post'),
            `${name} to give the answer, got ${result}`,
          )
          must(!result.includes('"isError":true'), `${name} not to fail, got ${result}`)
        }
        // The answer still arrives as its own turn after this one.
        await page.getByText('ACK E2E_DELIVERY:busy-answer').waitFor()
        await page.waitForTimeout(3_000)
        must(calls('request_user_decision').length === asked + 1, 'the question to be asked once')
        await page.emulateMedia({ colorScheme: 'light' })
        await page.screenshot({ path: `${artifacts}/busy-answer-light.png` })
        await page.emulateMedia({ colorScheme: null })
      } finally {
        rmSync(release, { force: true })
      }
    },
  },
]
