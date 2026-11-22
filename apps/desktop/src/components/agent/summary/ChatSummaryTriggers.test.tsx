import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { AgentTrigger } from '../../../api/agent-trigger-types'

const trigger: AgentTrigger = {
  id: 'trg-1',
  userId: 'u-1',
  name: 'Daily digest',
  triggerType: 'cron',
  cronExpression: '0 1 1 * *',
  scheduleDescription: 'Schedule: 0 1 1 * * (UTC)',
  nextRunAt: '2026-12-01T01:00:00Z',
  timeZone: 'UTC',
  messageTemplate: 'Summarise yesterday’s merged pull requests.',
  enabled: true,
  canManage: true,
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
}
const updates: { id: string; patch: unknown }[] = []
const edits: string[] = []

mock.module('../../../api', () => ({
  api: {
    agentListTriggers: async () => [trigger],
    agentUpdateTrigger: async (id: string, patch: { enabled: boolean }) => {
      updates.push({ id, patch })

      return { ...trigger, ...patch }
    },
  },
}))

mock.module('../../ui/toast', () => ({ toast: { apiError: () => {} } }))

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
const { ChatSummaryTriggers } = await import('./ChatSummaryTriggers')

async function mount() {
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)

  await act(async () => {
    root.render(
      createElement(ChatSummaryTriggers, {
        teamId: 'team',
        sessionId: 'bot',
        onEdit: (name: string) => edits.push(name),
      }),
    )
  })

  return container
}

test('a Trigger row opens its details, and its switch does not', async () => {
  const container = await mount()

  assert.ok(container.textContent?.includes('Scheduled times:'))
  assert.ok(container.textContent?.includes(Intl.DateTimeFormat().resolvedOptions().timeZone))
  assert.ok(!container.textContent?.includes('Schedule: 0 1 1 * *'))
  const row = container.querySelector<HTMLButtonElement>('button[aria-expanded]')

  assert.ok(row, 'the row is a disclosure button')
  assert.equal(row.getAttribute('aria-expanded'), 'false')
  assert.ok(!container.textContent?.includes(trigger.messageTemplate))

  await act(async () => row.click())
  assert.equal(row.getAttribute('aria-expanded'), 'true')
  assert.ok(container.textContent?.includes(trigger.messageTemplate), 'shows what it sends')
  const edit = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Edit')

  assert.ok(edit, 'an open row offers Edit')
  await act(async () => edit.click())
  assert.deepEqual(edits, ['Edit your trigger “Daily digest”: '], 'Edit asks the agent')

  await act(async () => row.click())
  assert.equal(row.getAttribute('aria-expanded'), 'false')

  const toggle = container.querySelector<HTMLButtonElement>('[aria-label="Enable Daily digest"]')

  assert.ok(toggle)
  await act(async () => toggle.click())
  assert.deepEqual(updates, [{ id: 'trg-1', patch: { enabled: false } }])
  assert.equal(row.getAttribute('aria-expanded'), 'false', 'the switch leaves the row closed')
})
