import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'

import type { ReactNode } from 'react'

const saved: unknown[][] = []

mock.module('../../../api', () => ({
  api: {
    agentRenameConversation: async () => ({ title: 'Pip' }),
    agentSetConversationAvatar: async (...args: unknown[]) => {
      saved.push(args)
    },
  },
}))
mock.module('../../Modal', () => ({
  Modal: ({ children }: { children: ReactNode }) => children,
}))
mock.module('../../ui/toast', () => ({ toast: { apiError: () => undefined } }))
mock.module('../AgentAvatarGrid', () => ({ AgentAvatarGrid: () => null }))
mock.module('../BotAvatarImage', () => ({ BotAvatarImage: () => null }))
const { receiveAgentAvatars, agentAvatarBackground } =
  await import('../../../lib/agentAvatarChoices')
const { RenameConversationDialog } = await import('./ConversationTitleEditor')

test('Edit Bot shows, previews and saves the background of the same character', async () => {
  const dom = new Window()
  const values = {
    window: dom,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    Node: dom.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  }
  const original = Object.keys(values).map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  )

  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  receiveAgentAvatars(
    [{ sessionId: 'bot-1', avatar: '07-ada', avatarBackground: 'sky' }],
    Date.now(),
  )
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)
  let closed = false

  try {
    await act(() =>
      root.render(
        createElement(RenameConversationDialog, {
          sessionId: 'bot-1',
          teamId: 'team-1',
          title: 'Pip',
          onClose: () => {
            closed = true
          },
        }),
      ),
    )
    const backgrounds = container.querySelector('[role="radiogroup"][aria-label="Background"]')
    const preview = () =>
      [...container.querySelectorAll('span[style]')].map(
        (span) => (span as unknown as HTMLElement).style.background,
      )

    assert.ok(backgrounds, 'Edit Bot offers a background for the character')
    assert.equal(
      backgrounds.querySelector('[aria-checked="true"]')?.getAttribute('aria-label'),
      'Sky',
    )
    assert.ok(preview().some((color) => color.includes('avatar-sky')))
    const mint = backgrounds.querySelector('[aria-label="Mint"]') as unknown as HTMLElement

    await act(() => mint.click())
    assert.ok(preview().some((color) => color.includes('avatar-mint')))
    const form = container.querySelector('form')

    assert.ok(form)
    await act(async () => {
      form.dispatchEvent(new dom.Event('submit', { bubbles: true, cancelable: true }))
    })
    assert.deepEqual(saved, [['bot-1', '07-ada', 'team-1', 'mint']])
    assert.equal(agentAvatarBackground('bot-1'), 'mint')
    assert.equal(closed, true)
  } finally {
    await act(() => root.unmount())
    await dom.happyDOM.close()
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})
