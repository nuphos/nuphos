import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

let shareable: boolean | undefined

mock.module('../../api.ts', () => ({
  api: {
    agentGetConversationParticipants: async () => ({
      generalAccess: 'none',
      ...(shareable === undefined ? {} : { shareable }),
      participants: [
        { id: 'owner', name: 'Ada', email: '', avatarURL: '', isOwner: true, role: 'owner' },
      ],
    }),
  },
}))

mock.module('../ui/toast', () => ({ toast: { apiError: () => {} } }))

const dom = new Window()
// The app's modules read browser globals as they load: every one the window has, once.
const browser: Record<string, unknown> = {
  window: dom,
  navigator: dom.navigator,
  IS_REACT_ACT_ENVIRONMENT: true,
}

for (const key of Object.getOwnPropertyNames(dom))
  if (!(key in globalThis)) browser[key] = Reflect.get(dom, key)
for (const [key, value] of Object.entries(browser))
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })

async function render() {
  const { SessionParticipants } = await import('./SessionParticipants')
  const { createRoot } = await import('react-dom/client')
  const document = dom.document as unknown as Document
  const container = document.createElement('div')

  document.body.append(container)
  const root = createRoot(container)

  await act(() =>
    root.render(
      createElement(SessionParticipants, {
        sessionId: 's',
        teamId: 'team',
        title: 'Task',
        currentUserId: 'owner',
        canManage: true,
      }),
    ),
  )
  await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
  const shown = container.querySelector('[title="Share with a teammate"]') !== null

  await act(() => root.unmount())

  return shown
}

test('Share shows only on what may be shared, and on servers that do not say', async () => {
  shareable = true
  assert.equal(await render(), true)
  shareable = undefined
  assert.equal(await render(), true, 'an older server never says, and kept Share')
  shareable = false
  assert.equal(await render(), false, 'a Bot or what an agent opened offers no Share')
})
