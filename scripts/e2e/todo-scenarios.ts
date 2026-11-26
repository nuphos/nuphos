// #4960: a Task's to-do list and open Inbox questions ride on each later turn as one Pending line,
// written by the real backend and read by the agent, and the line goes once both are cleared.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { agentLog } from './agent-log.ts'
import { must } from './binding-access-scenarios.ts'
import { artifacts } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

const call = (name: string, args: Record<string, unknown>) =>
  `E2E_CALL ${name} ${JSON.stringify({ label: name, ...args })}`

/** Sends one turn and waits for the fixture agent's answer to it. */
async function turn(page: Page, text: string, marker: string) {
  await send(page, `${text} E2E_DELIVERY:${marker}`)
  await page.getByText(`ACK E2E_DELIVERY:${marker}`).waitFor()
}

export const todoScenarios: Scenario[] = [
  {
    name: "a Task's open to-dos and Inbox questions ride on its next turn as a Pending line",
    run: async (page, stack) => {
      const calls = (name: string) =>
        agentLog(stack).filter((entry) => entry.event === 'called' && entry.name === name)
      const pendingOf = (marker: string) =>
        agentLog(stack).find((entry) => entry.event === 'start' && entry.marker === marker)
      const added = calls('todos').length
      const asked = calls('request_user_decision').length

      await newTask(page)
      await turn(
        page,
        [
          'Track the draft',
          call('todos', { action: 'add', title: 'Ship the E2E draft' }),
          call('request_user_decision', {
            category: 'approval',
            question: 'Publish the E2E draft?',
            body: 'It is ready.',
            options: ['Publish', 'Wait'],
          }),
        ].join('\n'),
        'todo-add',
      )
      const todoId = /([0-9a-f]{24})/.exec(JSON.stringify(calls('todos')[added]?.result))?.[1]
      const requestId = /(nuphos-[0-9a-f-]{36})/.exec(
        JSON.stringify(calls('request_user_decision')[asked]?.result),
      )?.[1]

      must(Boolean(todoId), `todos add to return an id, got ${JSON.stringify(calls('todos'))}`)
      must(Boolean(requestId), 'the question to be asked')

      await turn(page, 'Carry on', 'todo-next')
      const next = pendingOf('E2E_DELIVERY:todo-next')?.pending

      writeFileSync(join(artifacts, 'todo-pending-line.txt'), next ?? '(none)')
      must(
        next === 'Pending: inbox 1 (oldest <1h), todos 1 (oldest <1h).',
        `the next turn to carry the Pending line, got ${String(next)}`,
      )

      await turn(
        page,
        [
          'Wrap up',
          call('todos', { action: 'list' }),
          call('todos', { action: 'done', id: todoId }),
          call('withdraw_user_decision', { requestId }),
        ].join('\n'),
        'todo-done',
      )
      const listed = JSON.stringify(calls('todos').at(-2)?.result)

      must(listed.includes('Ship the E2E draft'), `list to show the to-do, got ${listed}`)
      await turn(page, 'Anything left?', 'todo-clear')
      const cleared = pendingOf('E2E_DELIVERY:todo-clear')?.pending

      must(cleared === undefined, `no Pending line once both are cleared, got ${String(cleared)}`)
    },
  },
]
