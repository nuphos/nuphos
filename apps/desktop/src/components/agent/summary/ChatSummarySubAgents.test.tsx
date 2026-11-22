import assert from 'node:assert/strict'

import { test } from 'bun:test'
import { Window } from 'happy-dom'
import { act } from 'react'

import type { SubAgent } from './chatSummaryModel'

const dom = new Window()

for (const key of Object.getOwnPropertyNames(dom))
  if (!(key in globalThis))
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value: Reflect.get(dom, key),
    })
Object.assign(globalThis, {
  window: dom,
  navigator: dom.navigator,
  IS_REACT_ACT_ENVIRONMENT: true,
  ResizeObserver: class {
    observe() {}
    disconnect() {}
  },
})
Object.defineProperty(dom.HTMLDivElement.prototype, 'scrollHeight', {
  configurable: true,
  get() {
    return this.childElementCount * 36
  },
})
document.documentElement.style.fontSize = '16px'
const { createRoot } = await import('react-dom/client')
const { SubAgentsSection } = await import('./ChatSummarySubAgents')
const { setSubAgentsFilter } = await import('../../../lib/chatSummaryPanel')

test('long lists expand separately from filters, short filtered lists omit expansion', async () => {
  const node = document.createElement('div')
  const root = createRoot(node)
  const opened: string[] = []
  const subAgents = Array.from({ length: 12 }, (_, i) => ({
    conversation: { sessionId: String(i), title: `Task ${i}` },
    state: i < 2 ? 'running' : 'done',
  })) as SubAgent[]

  setSubAgentsFilter('all')
  await act(() =>
    root.render(<SubAgentsSection subAgents={subAgents} onOpen={(id) => opened.push(id)} />),
  )
  const expand = [...node.querySelectorAll('button')].find(
    (button) => button.textContent === 'Expand all',
  )

  assert.ok(expand)
  assert.equal(expand.getAttribute('aria-expanded'), 'false')
  await act(() => expand.click())
  assert.equal(expand.getAttribute('aria-expanded'), 'true')
  const active = node.querySelector<HTMLButtonElement>('[data-filter="active"]')

  assert.ok(active)
  await act(() => active.click())
  assert.ok(!node.textContent?.includes('Expand all'))
  assert.ok(!node.textContent?.includes('Show less'))
  const first = [...node.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('Task 0'),
  )

  assert.ok(first)
  await act(() => first.click())
  assert.deepEqual(opened, ['0'])
  const all = node.querySelector<HTMLButtonElement>('[data-filter="all"]')

  assert.ok(all)
  await act(() => all.click())
  const restored = [...node.querySelectorAll('button')].find(
    (button) => button.textContent === 'Expand all',
  )

  assert.ok(restored)
  assert.equal(restored.getAttribute('aria-expanded'), 'false')
  assert.ok(node.textContent?.includes('Task 11'))
  await act(() => root.unmount())
})
