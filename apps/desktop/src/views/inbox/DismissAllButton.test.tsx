import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { Fragment, act, cloneElement, createElement } from 'react'

import type { InboxQuestion } from './inboxItems'
import type { ReactElement, ReactNode } from 'react'

// Each "Dismiss all" sent: the ids it was given.
const sent: string[][] = []
const toasts: string[] = []

mock.module('./dismissAll', () => ({
  dismissQuestions: (_team: string, rows: InboxQuestion[]) => {
    sent.push(rows.map((row) => row.request.id))
  },
}))
mock.module('../../components/sidebar/project-actions', () => ({ iconButton: 'icon' }))
mock.module('../../components/ui/toast', () => ({
  toast: {
    success: (title: string) => toasts.push(title),
    error: (title: string) => toasts.push(title),
  },
}))
mock.module('../../components/ui/tooltip', () => ({
  Tooltip: ({ trigger, children }: { trigger: ReactElement; children: ReactNode }) =>
    cloneElement(trigger, {}, children),
}))
// The dialog as plain elements: its title, and its confirm.
mock.module('../../components/ConfirmDialog', () => ({
  ConfirmDialog: (props: { open: boolean; title: string; onConfirm: () => void }) =>
    props.open &&
    createElement(
      'div',
      { role: 'alertdialog', title: props.title },
      createElement('button', { type: 'button', 'data-confirm': true, onClick: props.onConfirm }),
    ),
}))

const { DismissAllButton } = await import('./DismissAllButton')
const selection = await import('./inboxSelection')

// Whether the Inbox's keys rest, as InboxView reads it.
function Asking() {
  return createElement('i', { 'data-asking': String(selection.useDismissAllAsking('team')) })
}
const row = (id: string) =>
  ({ conversation: { sessionId: 's' }, request: { id, question: id } }) as InboxQuestion

test('"Dismiss all" in the sidebar shows for one question or more, and says which it dismisses', async () => {
  const dom = new Window()
  const values = {
    window: dom,
    document: dom.document,
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
  const render = (questions: InboxQuestion[]) =>
    act(() =>
      root.render(
        createElement(
          Fragment,
          null,
          createElement(DismissAllButton, { teamId: 'team', questions }),
          createElement(Asking),
        ),
      ),
    )
  const asking = () => container.querySelector('i')?.getAttribute('data-asking')
  const button = () => container.querySelector('button[aria-label="Dismiss all"]')
  const dialog = () => container.querySelector('[role="alertdialog"]')
  const press = (element: Element | null) => act(() => (element as unknown as HTMLElement).click())

  try {
    await render([])
    assert.equal(button(), null, 'hidden while the list is empty')
    await render([row('a')])
    assert.ok(button(), 'shown for a single question')
    await press(button())
    assert.equal(dialog()?.getAttribute('title'), 'Dismiss 1 question?')
    assert.equal(asking(), 'true', "the Inbox's keys rest while it asks")
    await render([row('a'), row('b')])
    assert.equal(dialog()?.getAttribute('title'), 'Dismiss 2 questions?')
    await press(container.querySelector('[data-confirm]'))
    assert.deepEqual(sent, [['a', 'b']], 'it dismisses the rows the list shows')
    assert.deepEqual(toasts, [], 'sent at once, with no Undo toast')

    // With a search above the list, the list holds its matches, and the title says so.
    await act(() => selection.setInboxSearch('team', 'retry'))
    await render([row('b')])
    await press(button())
    assert.equal(dialog()?.getAttribute('title'), 'Dismiss 1 matching question?')
    await act(() => selection.setInboxSearch('team', ''))
    assert.equal(dialog()?.getAttribute('title'), 'Dismiss 1 question?')

    // Answered meanwhile elsewhere, the list empties: it stops asking and goes.
    await render([])
    assert.equal(dialog(), null)
    assert.equal(button(), null)
    assert.equal(asking(), 'false', "and the Inbox's keys work again")
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
