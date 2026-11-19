import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement, useRef } from 'react'

import type { Item } from './types'

mock.module('./use-inbox-badge', () => ({
  useInboxBadge: (_team: string, sections: unknown) => sections,
}))

test('crossing the read boundary preserves real task rows, focus and the running move', async () => {
  const dom = new Window()
  const values = {
    window: dom,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    location: dom.location,
    localStorage: dom.localStorage,
    navigator: dom.navigator,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
  }
  const original = Object.keys(values).map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  )

  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { value, configurable: true })
  Object.defineProperty(dom.HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value(this: HTMLElement) {
      const index = this.parentElement ? Array.from(this.parentElement.children).indexOf(this) : 0

      return { top: this.dataset.taskReflowKey ? index * 40 : 0 }
    },
  })
  let moves = 0
  let canceled = 0

  Object.defineProperty(dom.HTMLElement.prototype, 'animate', {
    configurable: true,
    value: () => {
      moves++

      return {
        cancel: () => {
          canceled++
        },
      }
    },
  })
  const { createRoot } = await import('react-dom/client')
  const { SidebarSectionList } = await import('./sections-list')
  const { taskPageSections } = await import('./task-page-sections')
  const { useTaskReflow } = await import('./useTaskReflow')
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)
  const row = (id: string, unread: boolean): Item => ({
    key: `agent-session:${id}`,
    label: id,
    task: true,
    enabled: true,
    unread,
  })

  function Fixture({ unread }: { unread: string }) {
    const ref = useRef<HTMLDivElement>(null)

    useTaskReflow(ref)

    return createElement(
      'div',
      { ref },
      createElement(SidebarSectionList, {
        sections: taskPageSections([row('a', unread === 'a'), row('b', unread === 'b')]),
        scope: { kind: 'team', teamId: 'continuity' },
        active: '',
        teamView: true,
        newChatActive: false,
        archivingIds: new Set<string>(),
        isGroupCollapsed: () => false,
        toggleGroup: () => {},
        favoriteMatch: () => {},
        canFavorite: () => false,
        toggleFavorite: () => {},
        onItemMenu: () => {},
        onSelect: () => {},
      }),
    )
  }
  const render = (unread: string) => act(() => root.render(createElement(Fixture, { unread })))

  try {
    await render('a')
    const a = container.querySelector('[data-task-reflow-key="agent-session:a"]')
    const b = container.querySelector('[data-task-reflow-key="agent-session:b"]')
    const button = a?.querySelector('button')

    assert.ok(a && b && button)
    ;(button as unknown as HTMLButtonElement).focus()
    const focused = dom.document.activeElement

    await render('b')
    assert.equal(container.querySelector('[data-task-reflow-key="agent-session:a"]'), a)
    assert.equal(container.querySelector('[data-task-reflow-key="agent-session:b"]'), b)
    assert.equal(dom.document.activeElement, focused)
    assert.ok(a.classList.contains('t-task-row'))
    assert.equal(moves, 2)
    await render('b')
    assert.equal(moves, 2)
    assert.equal(canceled, 0)
    await act(() => root.unmount())
    assert.equal(canceled, 2)
  } finally {
    await dom.happyDOM.close()
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})
