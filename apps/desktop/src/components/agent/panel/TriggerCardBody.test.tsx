import assert from 'node:assert/strict'

import { test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { AgentTrigger } from '../../../api/agent-trigger-types'

const trigger: AgentTrigger = {
  id: 'trg-1',
  userId: 'u-1',
  name: 'Hourly report',
  triggerType: 'cron',
  cronExpression: '0 * * * *',
  timeZone: 'UTC',
  messageTemplate: 'Report on the last hour.',
  enabled: false,
  canManage: true,
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
}

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
const { NextRuns } = await import('./TriggerCardBody')

async function render(shown: AgentTrigger) {
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  await act(async () => {
    createRoot(container as unknown as HTMLElement).render(
      createElement(NextRuns, { trigger: shown }),
    )
  })

  return container.textContent
}

// #4293: the Trigger card said only "Paused" when Nuphos had paused it and said why.
test('a Trigger Nuphos paused says why on its card', async () => {
  const reason = 'Paused after 3 runs in a row failed. Then turn the Trigger back on.'

  assert.equal(await render({ ...trigger, executionAuthorizationError: reason }), reason)
})

test('a Trigger a person paused says how to resume it', async () => {
  assert.equal(await render(trigger), 'Paused. Turn it on to resume its runs.')
})
