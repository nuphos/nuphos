import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { RuntimeInstance, RuntimeQuota } from '../../types/runtime'

mock.module('../../hooks/useThisComputer', () => ({ useThisComputer: () => null }))

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

const { AgentUsageRow } = await import('./AgentUsageRow')
const { RuntimeUsageSection } = await import('./RuntimeOverview')
const { createRoot } = await import('react-dom/client')

const quota: RuntimeQuota = {
  runtimeId: 'rt-1',
  provider: 'claude-code',
  fetchedAt: '2026-11-19T10:00:00Z',
  available: true,
  windows: [
    { id: 'five_hour', label: '5-hour', usedPercent: 35.4, resetsAt: null },
    { id: 'seven_day', label: 'Weekly', usedPercent: 87, resetsAt: null },
  ],
}
const instance = {
  id: 'rt-1',
  label: 'Claude Code',
  provider: 'claude-code',
  status: 'active',
} as RuntimeInstance

/** Each usage bar's figure and fill, in order. */
async function readBars(element: ReturnType<typeof createElement>) {
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)

  try {
    await act(() => root.render(element))

    return {
      figures: (container.textContent ?? '').match(/\d{1,3}% left/gu),
      fills: [...container.querySelectorAll('[role="progressbar"] > *')].map(
        (fill) => (fill as unknown as HTMLElement).style.width,
      ),
    }
  } finally {
    await act(() => root.unmount())
  }
}

test('the Runtimes row and the details panel read the same usage the same way', async () => {
  const row = await readBars(
    createElement(AgentUsageRow, { instance, quota, selected: false, onSelect: () => null }),
  )
  const details = await readBars(createElement(RuntimeUsageSection, { quota }))

  assert.deepEqual(details, { figures: ['64% left', '13% left'], fills: ['64%', '13%'] })
  assert.deepEqual(row, details)
})
