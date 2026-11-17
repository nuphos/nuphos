import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { ReactNode } from 'react'

mock.module('./ui/menu', () => ({
  Menu: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  MenuContent: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  MenuItem: ({ children, onClick }: { children: ReactNode; onClick: () => void }) =>
    createElement('button', { type: 'button', 'data-item': true, onClick }, children),
  MenuSeparator: () => null,
  MenuGroupLabel: () => null,
}))
mock.module('./ui/alert-dialog', () => ({
  AppAlertDialog: (props: { open: boolean; confirmLabel: string }) =>
    props.open ? createElement('div', { 'data-confirm-label': props.confirmLabel }) : null,
}))

const { ContextMenu } = await import('./ContextMenu')

async function confirmLabelFor(item: {
  label: string
  destructive?: boolean
  confirmLabel?: string
}) {
  const dom = new Window()

  for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  }))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  const { createRoot } = await import('react-dom/client')
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)

  await act(() =>
    root.render(
      createElement(ContextMenu, {
        x: 0,
        y: 0,
        onClose: () => {},
        items: [{ key: 'a', ...item, confirm: 'Sure?', onSelect: () => {} }],
      }),
    ),
  )
  await act(() => (container.querySelector('[data-item]') as unknown as HTMLElement).click())
  const label = container.querySelector('[data-confirm-label]')?.getAttribute('data-confirm-label')

  await act(() => root.unmount())

  return label
}

test('a destructive confirm names its action instead of saying Delete', async () => {
  assert.equal(
    await confirmLabelFor({ label: 'Remove from team', destructive: true }),
    'Remove from team',
  )
  assert.equal(
    await confirmLabelFor({ label: 'Cancel invite', destructive: true }),
    'Cancel invite',
  )
  assert.equal(await confirmLabelFor({ label: 'Make Viewer' }), 'Confirm')
  assert.equal(
    await confirmLabelFor({
      label: 'Cancel invite',
      destructive: true,
      confirmLabel: 'Withdraw invite',
    }),
    'Withdraw invite',
  )
})
