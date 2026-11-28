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
Object.assign(globalThis, { window: dom, navigator: dom.navigator, IS_REACT_ACT_ENVIRONMENT: true })
const { createRoot } = await import('react-dom/client')
const { SubAgentsSection } = await import('./ChatSummarySubAgents')
const { setSubAgentsFilter } = await import('../../../lib/chatSummaryPanel')

const subAgents = (length: number) =>
  Array.from({ length }, (_, i) => ({
    conversation: { sessionId: String(i), title: `Task ${i}` },
    state: i < 2 ? 'running' : 'done',
  })) as SubAgent[]

async function mount(list: SubAgent[], opened: string[] = []) {
  const node = document.createElement('div')
  const root = createRoot(node)

  setSubAgentsFilter('all')
  await act(() =>
    root.render(<SubAgentsSection subAgents={list} onOpen={(id) => opened.push(id)} />),
  )
  const button = (text: string) =>
    [...node.querySelectorAll('button')].find((b) => b.textContent === text)
  const rows = () =>
    [...node.querySelectorAll('button')].filter((b) => b.textContent?.startsWith('Task')).length

  return { node, root, button, rows }
}

test('long lists show the first rows and a count of the rest; filters reset expansion', async () => {
  const opened: string[] = []
  const { node, root, button, rows } = await mount(subAgents(14), opened)
  const more = button('Show 4 more')

  assert.ok(more)
  assert.equal(more.getAttribute('aria-expanded'), 'false')
  assert.equal(rows(), 10)
  await act(() => more.click())
  assert.equal(more.textContent, 'Show less')
  assert.equal(more.getAttribute('aria-expanded'), 'true')
  assert.equal(rows(), 14)
  const active = node.querySelector<HTMLButtonElement>('[data-filter="active"]')

  assert.ok(active)
  await act(() => active.click())
  assert.equal(rows(), 2)
  assert.ok(!node.textContent?.includes('Show less'))
  assert.ok(!node.textContent?.includes(' more'))
  const first = button('Task 0Running')

  assert.ok(first)
  await act(() => first.click())
  assert.deepEqual(opened, ['0'])
  const all = node.querySelector<HTMLButtonElement>('[data-filter="all"]')

  assert.ok(all)
  await act(() => all.click())
  assert.equal(button('Show 4 more')?.getAttribute('aria-expanded'), 'false')
  assert.equal(rows(), 10)
  await act(() => root.unmount())
})

test('one hidden row reads singular; a list that fits has no button', async () => {
  const eleven = await mount(subAgents(11))

  assert.ok(eleven.button('Show 1 more'))
  await act(() => eleven.root.unmount())
  const ten = await mount(subAgents(10))

  assert.equal(ten.rows(), 10)
  assert.ok(!ten.node.textContent?.includes(' more'))
  await act(() => ten.root.unmount())
})
