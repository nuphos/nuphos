import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { DatabaseConnection } from '../../types'

const saved: unknown[] = []

mock.module('../../api', () => ({
  api: {
    atlasUpdateDatabaseConnection: async (_team: string, _id: string, patch: unknown) => {
      saved.push(patch)

      return { ...connection, changeApprovalPolicy: { minimumApprovals: 1 } }
    },
  },
}))
mock.module('../../components/ui/toast', () => ({
  toast: { success: () => {}, apiError: () => {} },
}))

const { ConnectionSettingsSection } = await import('./ConnectionSettings')

const connection = {
  id: 'conn',
  name: 'orders',
  engine: 'mongodb',
  changeApprovalPolicy: { minimumApprovals: 2 },
} as unknown as DatabaseConnection

test('the approval policy is the connection’s own, saved through the connection', async () => {
  const dom = new Window()

  for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
  }))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  const { createRoot } = await import('react-dom/client')
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)
  let current = connection

  const render = () =>
    root.render(
      createElement(ConnectionSettingsSection, {
        teamId: 'team',
        connection: current,
        busy: false,
        isTeamAdmin: true,
        onRemoveOpen: () => {},
        onConnectionChange: (next: DatabaseConnection) => {
          current = next
          render()
        },
      }),
    )
  const button = (label: string) =>
    [...dom.document.querySelectorAll('button')].find((node) => node.textContent === label)

  await act(async () => render())
  assert.match(container.textContent, /Requester \+ 2 teammates/)

  await act(async () => button('Edit')?.click())
  // No radio takes focus on open, so the unselected ones all look the same.
  assert.notEqual(dom.document.activeElement?.getAttribute('type'), 'radio')
  const oneTeammate = [...dom.document.querySelectorAll('input[type="radio"]')][1]

  await act(async () => (oneTeammate as unknown as HTMLInputElement).click())
  await act(async () => button('Save policy')?.click())

  assert.deepEqual(saved, [{ changeApprovalPolicy: { minimumApprovals: 1 } }])
  assert.match(container.textContent, /Requester \+ one teammate/)
  root.unmount()
})
