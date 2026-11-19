import assert from 'node:assert/strict'

import { test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { SidebarPage } from './swipe-gesture'
import type { Section } from './types'

// The Bots page with one Bot chat, and the Tasks page with one Task.
const sections: Section[] = [
  { title: 'Channels', items: [{ key: 'agent-session:bot-chat', label: 'Bot', enabled: true }] },
  {
    title: 'Tasks',
    items: [{ key: 'agent-session:task', label: 'Task', enabled: true, task: true }],
  },
]

test('switching to Bots opens its Bot in the same call, with no frame of the empty page between', async () => {
  const dom = new Window()
  const values = {
    window: dom,
    document: dom.document,
    localStorage: dom.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  }
  const original = Object.keys(values).map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  )

  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  const { useSidebarModeNavigation } = await import('./useSidebarModeNavigation')
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(dom.document.createElement('div') as unknown as HTMLElement)
  const events: string[] = []
  let change: ((page: SidebarPage) => void) | undefined
  const Probe = () => {
    change = useSidebarModeNavigation((page) => events.push(`page ${page}`), sections, {
      // The Tasks page, on its New task page: nothing open.
      scope: { kind: 'team', teamId: 'team' },
      active: 'team.agent',
      onSelect: (key: string) => events.push(`open ${key}`),
    } as never)

    return null
  }

  try {
    await act(() => root.render(createElement(Probe)))
    change!(0)
    // Both in the one call: React renders them together, so Bots never shows without its Bot.
    assert.deepEqual(events, ['page 0', 'open agent-session:bot-chat'])
  } finally {
    await act(() => root.unmount())
    await dom.happyDOM.close()
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})
