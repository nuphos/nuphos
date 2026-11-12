import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Window } from 'happy-dom'
import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { SidebarStatsButton } from './SidebarStatsButton'

test('Stats toggles back to the selected conversation without replacing it with a new task', async () => {
  const dom = new Window()
  const values = {
    window: dom,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  }
  const descriptors = Object.keys(values).map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  )

  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { value, configurable: true })
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)
  const changes: string[] = []

  function Fixture() {
    const [active, setActive] = useState('team.agent')

    return createElement(SidebarStatsButton, {
      active,
      agentSessionId: 'remember-me',
      onSelect: (key) => {
        changes.push(key)
        setActive(key)
      },
    })
  }
  try {
    await act(() => root.render(createElement(Fixture)))
    const button = container.querySelector('button')!

    await act(() => button.click())
    assert.deepEqual(changes, ['team.home'])
    assert.equal(button.getAttribute('aria-pressed'), 'true')
    await act(() => button.click())
    assert.deepEqual(changes, ['team.home', 'agent-session:remember-me'])
    assert.equal(button.getAttribute('aria-pressed'), 'false')
    await act(() =>
      root.render(
        createElement(SidebarStatsButton, {
          teamId: 'empty-team',
          active: '',
          agentSessionId: null,
          onSelect: (key) => changes.push(key),
        }),
      ),
    )
    await act(() => container.querySelector('button')!.click())
    await act(() =>
      root.render(
        createElement(SidebarStatsButton, {
          teamId: 'empty-team',
          active: 'team.home',
          agentSessionId: null,
          onSelect: (key) => changes.push(key),
        }),
      ),
    )
    await act(() => container.querySelector('button')!.click())
    assert.deepEqual(
      changes.slice(-2),
      ['team.home', 'team.agent'],
      'Stats must return to the empty Bots/Tasks surface, never navigate to an empty page key',
    )
  } finally {
    await act(() => root.unmount())
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
    await dom.happyDOM.close()
  }
})
