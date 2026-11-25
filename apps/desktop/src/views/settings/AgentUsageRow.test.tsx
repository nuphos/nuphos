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

/** The row's text and its bar's fill. */
async function render(element: ReturnType<typeof createElement>) {
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)

  try {
    await act(() => root.render(element))

    return {
      text: container.textContent ?? '',
      fill: (container.querySelector('[role="progressbar"] > *') as unknown as HTMLElement | null)
        ?.style.width,
    }
  } finally {
    await act(() => root.unmount())
  }
}

const hours = (values: number[]) => values.map((value, i) => ({ at: i * 3_600_000, value }))
const row = (q: RuntimeQuota, peak?: ReturnType<typeof hours>) =>
  render(
    createElement(AgentUsageRow, {
      instance,
      quota: q,
      peak,
      selected: false,
      onSelect: () => null,
    }),
  )

test('the row shows the busiest window used now and no hours at a limit', async () => {
  const { text, fill } = await row(quota, hours([20, 40, 87]))

  assert.equal(fill, '87%')
  assert.match(text, /87%/u)
  assert.match(text, /–$/u)
})

test('a used-up window reads Limit, and hours at a limit add up', async () => {
  const usedUp = { ...quota, windows: [{ ...quota.windows[1]!, usedPercent: 100 }] }
  const { text, fill } = await row(usedUp, hours([60, 100, 100, 80, 100]))

  assert.equal(fill, '100%')
  assert.match(text, /Limit/u)
  assert.match(text, /3 h$/u)
})
