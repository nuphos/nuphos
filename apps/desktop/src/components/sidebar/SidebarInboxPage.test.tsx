import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { InboxQuestion } from '../../views/inbox/inboxItems'
import type { ReactNode } from 'react'

// The open questions the listing has; each step sets them.
let questions: InboxQuestion[] = []

mock.module('../../views/inbox/useInboxQuestions', () => ({
  useInboxQuestions: (_team: string, _key?: unknown, snoozed = false) => (snoozed ? [] : questions),
}))
mock.module('../../views/inbox/dismissQuestion', () => ({ snoozeQuestion: async () => {} }))
// The rows as their ids, and "Dismiss all" as the rows it would take.
mock.module('../../views/inbox/QuestionRail', () => ({
  QuestionRail: ({ rows }: { rows: InboxQuestion[] }) =>
    rows.map((row) => createElement('a', { key: row.request.id, 'data-row': row.request.id })),
  SnoozedRail: () => null,
}))
mock.module('../../views/inbox/DismissAllButton', () => ({
  DismissAllButton: ({ questions: rows }: { questions: InboxQuestion[] }) =>
    rows.length > 0 &&
    createElement('button', { type: 'button', 'aria-label': 'Dismiss all', 'data-n': rows.length }),
}))
mock.module('../SkeletonReveal', () => ({
  SkeletonReveal: ({ children }: { children: ReactNode }) => children,
}))
mock.module('./parts', () => ({ SidebarSectionSkeleton: () => null }))

const { SidebarInboxPage } = await import('./SidebarInboxPage')
const selection = await import('../../views/inbox/inboxSelection')

const ask = (id: string, question: string) =>
  ({
    conversation: { sessionId: id, title: 'Release' },
    request: { id, question },
  }) as InboxQuestion

test('the Inbox search sits under the sidebar header and narrows the list "Dismiss all" takes', async () => {
  const dom = new Window()
  const values = {
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  }
  const originals = Object.keys(values).map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  )

  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  const { createRoot } = await import('react-dom/client')
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)
  const render = () =>
    act(() =>
      root.render(
        createElement(SidebarInboxPage, {
          teamId: 'team',
          onOpenInbox: () => {},
          onScroll: () => {},
        }),
      ),
    )
  const box = () => container.querySelector<HTMLInputElement>('[data-inbox-search] input')
  const rows = () =>
    [...container.querySelectorAll('[data-row]')].map((row) => row.getAttribute('data-row'))
  const dismissAll = () => container.querySelector('button[aria-label="Dismiss all"]')
  const type = (text: string) =>
    act(() => {
      const input = box() as unknown as InstanceType<typeof dom.HTMLInputElement>
      const setValue = Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, 'value')?.set

      setValue?.call(input, text)
      input.dispatchEvent(new dom.Event('input', { bubbles: true }))
    })

  try {
    questions = [ask('a', 'Ship on Friday?'), ask('b', 'Retry the deploy?')]
    await render()
    const header = container.querySelector('h3')?.parentElement

    assert.ok(box(), 'the search shows while there are questions')
    assert.equal(
      header?.nextElementSibling?.hasAttribute('data-inbox-search'),
      true,
      'right under the header',
    )
    assert.equal(box()?.value, '', 'empty at first')
    assert.equal(box()?.placeholder, 'Filter', 'only its placeholder, no count')
    assert.equal(box()?.getAttribute('aria-label'), 'Filter')
    assert.ok(
      header?.contains(dismissAll() as unknown as Node),
      '"Dismiss all" stays in the header',
    )

    await type('deploy')
    assert.equal(selection.inboxSearch('team'), 'deploy', 'the Inbox page reads the same search')
    assert.deepEqual(rows(), ['b'])
    assert.equal(dismissAll()?.getAttribute('data-n'), '1', '"Dismiss all" takes the row listed')

    await type('nothing like it')
    assert.deepEqual(rows(), [])
    assert.ok(box(), 'a search that matches nothing stays, so it can be cleared')
    assert.equal(dismissAll(), null)
    assert.match(container.textContent ?? '', /No matches/)

    await type('deploy')
    await act(() => root.render(null))
    assert.equal(selection.inboxSearch('team'), '', 'the page goes away: the Inbox filters nothing')
    await render()
    assert.equal(box()?.value, '', 'and it comes back empty')
    assert.deepEqual(rows(), ['a', 'b'])

    questions = []
    await render()
    assert.equal(box(), null, 'no question: no search')
    assert.equal(dismissAll(), null, 'and no "Dismiss all"')
    assert.equal(selection.inboxSearch('team'), '', 'and nothing left hidden in it')
    assert.match(container.textContent ?? '', /You're all caught up/)
  } finally {
    await act(() => root.unmount())
    await dom.happyDOM.close()
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
    mock.restore()
  }
})
