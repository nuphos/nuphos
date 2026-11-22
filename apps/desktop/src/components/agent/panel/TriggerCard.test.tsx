import assert from 'node:assert/strict'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { AgentTrigger } from '../../../api/agent-trigger-types'
import type { ToolPart } from './parts'

let target = 'task-1'
const TRIGGER_ID = '6b00eb7166ad4469f8cbc41a'
const trigger: AgentTrigger = {
  id: TRIGGER_ID,
  userId: 'u-1',
  name: 'Hourly report',
  triggerType: 'cron',
  cronExpression: '0 * * * *',
  timeZone: 'UTC',
  messageTemplate: 'Report on the last hour.',
  enabled: true,
  canManage: true,
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
}

const real = await import('../../../api')

mock.module('../../../api', () => ({
  ...real,
  api: { ...real.api, agentGetTrigger: async () => ({ ...trigger, targetSessionId: target }) },
}))

const dom = new Window()
const browser: Record<string, unknown> = {
  window: dom,
  navigator: dom.navigator,
  IS_REACT_ACT_ENVIRONMENT: true,
}

for (const key of Object.getOwnPropertyNames(dom))
  if (!(key in globalThis)) browser[key] = Reflect.get(dom, key)
for (const [key, value] of Object.entries(browser))
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })

const { createRoot } = await import('react-dom/client')
const { queryKeys } = await import('../../../lib/query/keys')
const { TriggerCard } = await import('./TriggerCard')

const part: ToolPart = {
  type: 'tool',
  toolCallId: 'call-1',
  toolName: 'Bash',
  state: 'output-available',
  input: { command: `bash trigger-api.sh team PATCH ${TRIGGER_ID} @trigger.json` },
  output: { stdout: JSON.stringify({ id: TRIGGER_ID, triggerType: 'cron' }) },
}
// The chats the sidebar listed: a Bot wears a face, a Task does not.
const chat = { firstMessage: '', messageCount: 1, createdAt: '', lastActiveAt: '' }
const listed = [
  { ...chat, sessionId: 'task-1', title: 'Weekly metrics' },
  { ...chat, sessionId: 'bot-1', title: 'Metrics Bot', avatar: '07-ada' },
]

/** The card's footer, as it reads, once the trigger running in `to` has loaded. */
async function footer(to: string, shownIn = 'task-here') {
  target = to
  const client = new QueryClient()

  client.setQueryData(queryKeys.agentSessions('team'), listed)
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  await act(async () => {
    createRoot(container as unknown as HTMLElement).render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(TriggerCard, { part, teamId: 'team', sessionId: shownIn }),
      ),
    )
  })
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
  assert.ok(container.textContent?.includes('Hourly report'), 'the trigger loaded')

  return container.querySelector('footer')?.textContent ?? null
}

// #4301 and #4304: the footer said "Open conversation", whatever it opened.
test("a Trigger card's link names the Task it opens", async () => {
  assert.equal(await footer('task-1'), 'Weekly metrics')
})

test("a Trigger card's link names the Bot it opens", async () => {
  assert.equal(await footer('bot-1'), 'Metrics Bot')
})

test('a target the sidebar has not listed reads Open', async () => {
  assert.equal(await footer('task-archived'), 'Open')
})

test('a Trigger that runs in the chat it is shown in has no link', async () => {
  assert.equal(await footer('task-here', 'task-here'), null)
})
