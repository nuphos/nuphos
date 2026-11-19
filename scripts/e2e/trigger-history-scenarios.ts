// #3755: every create, change, pause and delete of a Trigger leaves a record, in the same
// transaction as the write, against the real backend and its replica-set MongoDB.
import { newTask, send } from './ui.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'

type Change = {
  action: string
  via: string
  client?: string
  actor: { type: string }
  before?: { name?: string; enabled?: boolean }
  after?: { name?: string; enabled?: boolean }
}

function call(stack: Stack, method: string, path: string, body?: unknown) {
  return fetch(stack.apiUrl + path, {
    method,
    headers: {
      authorization: `Bearer ${stack.token}`,
      'content-type': 'application/json',
      'x-atlas-client': 'nuphos-e2e',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

async function json<T>(response: Promise<Response>): Promise<T> {
  const answered = await response

  if (!answered.ok) throw new Error(`${answered.url} answered ${String(answered.status)}`)

  return (await answered.json()) as T
}

function same<T>(actual: T, expected: T) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

export const triggerHistoryScenarios: Scenario[] = [
  {
    name: 'a Trigger’s create, edits, pause and delete are recorded, and a write that lost its revision is not',
    // The renames that lose the race answer 409 trigger_changed, as they should.
    expected: /"status":409,"error_code":"trigger_changed"/,
    run: async (page, stack) => {
      await newTask(page)
      await send(page, 'Home of the Trigger history E2E_DELIVERY:trigger-history')
      await page.getByText('ACK E2E_DELIVERY:trigger-history', { exact: true }).waitFor()
      const { conversations } = await json<{ conversations: { sessionId: string }[] }>(
        call(stack, 'GET', `/agent/conversations?teamId=${stack.teamId}&search=trigger-history`),
      )
      const targetSessionId = conversations[0]?.sessionId
      const created = await json<{ id: string; webhookSecret: string }>(
        call(stack, 'POST', '/agent/triggers', {
          teamId: stack.teamId,
          targetSessionId,
          name: 'Deploy hook',
          triggerType: 'webhook',
          messageTemplate: 'Check the deploy',
        }),
      )
      const item = `/agent/triggers/${created.id}?teamId=${stack.teamId}`

      await json(call(stack, 'PATCH', item, { name: 'Deploy hook v2' }))
      await json(call(stack, 'PATCH', item, { enabled: false }))
      // Renames that race each other: each reads one revision and writes against it, so
      // all but one can lose it. Raced again until one did.
      const races: { name: string; status: number }[] = []

      for (let round = 0; round < 5 && !races.some((race) => race.status === 409); round++)
        races.push(
          ...(await Promise.all(
            Array.from({ length: 8 }, async (_, index) => {
              const name = `Race ${String(round)}.${String(index)}`

              return { name, status: (await call(stack, 'PATCH', item, { name })).status }
            }),
          )),
        )
      if (!races.some((race) => race.status === 409))
        throw new Error('No rename lost its revision in five rounds')
      await json(call(stack, 'DELETE', item))

      const { changes } = await json<{ changes: Change[] }>(
        call(
          stack,
          'GET',
          `/agent/triggers/history?teamId=${stack.teamId}&triggerId=${created.id}`,
        ),
      )
      const won = races.filter((race) => race.status === 200).map((race) => race.name)
      const recorded = changes.flatMap((change) =>
        change.after?.name?.startsWith('Race ') ? [change.after.name] : [],
      )

      // Newest first: the delete, the renames that won, the pause, the rename, the create.
      same(
        changes.map((change) => change.action),
        ['deleted', ...won.map(() => 'updated'), 'updated', 'updated', 'created'],
      )
      same(recorded.sort(), won.sort())
      const pause = changes.at(-3)

      if (pause?.before?.enabled !== true || pause.after?.enabled !== false)
        throw new Error(`The pause is not recorded: ${JSON.stringify(pause)}`)
      if (changes.some((change) => change.via !== 'request' || change.client !== 'nuphos-e2e'))
        throw new Error(`A record lacks its source: ${JSON.stringify(changes)}`)
      if (JSON.stringify(changes).includes(created.webhookSecret))
        throw new Error('A record holds the webhook secret')
    },
  },
]
