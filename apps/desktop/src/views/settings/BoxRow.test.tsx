import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { AgentDevice } from '../../api'
import type { ReactNode } from 'react'

mock.module('../../components/ui/menu', () => ({
  Menu: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  MenuTrigger: ({ children, ...props }: { children: ReactNode }) =>
    createElement('button', { type: 'button', ...props }, children),
  MenuContent: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  MenuItem: ({ children, onClick }: { children: ReactNode; onClick: () => void }) =>
    createElement('div', { role: 'menuitem', onClick }, children),
  MenuSeparator: () => null,
}))
mock.module('./LocalAgentShareDialog', () => ({
  LocalAgentShareDialog: () => createElement('div', { 'data-share-dialog': 'local' }),
}))
mock.module('./BoxAccessDialog', () => ({
  BoxAccessDialog: () => createElement('div', { 'data-share-dialog': 'cloud' }),
}))
mock.module('./ComputerSettingsDialog', () => ({
  useComputerSettings: () => ({ menuItem: null, dialog: null }),
}))
mock.module('./useComputerOwner', () => ({ useComputerOwner: () => null }))
mock.module('./useComputerUpdate', () => ({
  useComputerUpdate: () => ({ label: null, version: undefined, update: () => {} }),
}))

const { BoxRow } = await import('./BoxRow')

const device = (access: AgentDevice['access']): AgentDevice =>
  ({
    userId: 'owner',
    deviceId: 'd1',
    label: "Bryan's MacBook Pro",
    platform: 'darwin',
    allowLocalExec: true,
    online: true,
    access,
    createdAt: '2026-11-16T00:00:00Z',
    updatedAt: '2026-11-16T00:00:00Z',
  }) as unknown as AgentDevice

async function mount(access: AgentDevice['access']) {
  const dom = new Window()

  // Every desktop call stays pending: the row renders from its props alone.
  Object.assign(dom, { api: new Proxy({}, { get: () => () => new Promise(() => {}) }) })
  const values = {
    window: dom,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  }

  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  const { createRoot } = await import('react-dom/client')
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)

  await act(() =>
    root.render(
      createElement(BoxRow, {
        thisComputer: false,
        teamId: 'team',
        device: device(access),
        agents: [],
        onSelect: () => {},
        onChanged: () => {},
      }),
    ),
  )

  return { container, unmount: () => act(() => root.unmount()) }
}

const shareButton = (container: { querySelectorAll: (s: string) => Iterable<unknown> }) =>
  [...(container.querySelectorAll('button') as Iterable<HTMLElement>)].find(
    (button) => button.textContent === 'Share',
  )

test('someone who manages a computer shares it from its row in one click', async () => {
  const { container, unmount } = await mount('manage')
  const button = shareButton(container)

  try {
    assert.ok(button, 'the row shows Share')
    assert.equal(container.querySelector('[data-share-dialog]'), null)
    await act(() => button.click())
    assert.equal(
      container.querySelector('[data-share-dialog]')?.getAttribute('data-share-dialog'),
      'local',
    )
    // The menu keeps its own way in.
    assert.ok(
      [...container.querySelectorAll('[role="menuitem"]')].some(
        (item) => item.textContent === 'Manage access…',
      ),
    )
  } finally {
    await unmount()
  }
})

test('someone who only uses a computer gets no Share button', async () => {
  const { container, unmount } = await mount('use')

  try {
    assert.equal(shareButton(container), undefined)
  } finally {
    await unmount()
  }
})
