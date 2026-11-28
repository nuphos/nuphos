import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { ReactNode } from 'react'

const saved: unknown[][] = []
const instructions: unknown[][] = []

mock.module('../../../api', () => ({
  api: {
    agentRenameConversation: async () => ({ title: 'Pip' }),
    agentSetConversationAvatar: async (...args: unknown[]) => {
      saved.push(args)
    },
    agentSetBotInstructions: async (...args: unknown[]) => {
      instructions.push(args)

      return { instructions: args[1] }
    },
    agentListTriggers: async () => [],
  },
}))
mock.module('../../Modal', () => ({
  Modal: ({ children }: { children: ReactNode }) => children,
}))
mock.module('../../ui/toast', () => ({ toast: { apiError: () => undefined } }))
mock.module('../AgentAvatarGrid', () => ({ AgentAvatarGrid: () => null }))
mock.module('../BotAvatarImage', () => ({ BotAvatarImage: () => null }))
// React reads the DOM it runs in once, on import: its change events need the window first.
const dom = new Window()

const browser: Record<string, unknown> = {
  window: dom,
  navigator: dom.navigator,
  IS_REACT_ACT_ENVIRONMENT: true,
}

for (const key of Object.getOwnPropertyNames(dom))
  if (!(key in globalThis)) browser[key] = Reflect.get(dom, key)
for (const [key, value] of Object.entries(browser))
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
const { createRoot } = await import('react-dom/client')
const { receiveAgentAvatars, agentAvatarBackground } =
  await import('../../../lib/agentAvatarChoices')
const { queryClient } = await import('../../../lib/query/client')
const { queryKeys } = await import('../../../lib/query/keys')
const { RenameConversationDialog } = await import('./ConversationTitleEditor')

test('Edit Bot saves the background and, from Advanced, the instructions with one Save', async () => {
  receiveAgentAvatars(
    [{ sessionId: 'bot-1', avatar: '07-ada', avatarBackground: 'sky' }],
    Date.now(),
  )
  queryClient.setQueryData(queryKeys.agentSessions('team-1'), [
    { sessionId: 'bot-1', title: 'Pip', instructions: 'Be brief.' },
  ])
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
    const advanced = container.querySelector('[role="tab"]:nth-child(2)') as unknown as HTMLElement

    await act(async () => advanced.click())
    assert.match(container.textContent, /No triggers yet/)
    const textarea = container.querySelector('textarea') as unknown as HTMLTextAreaElement

    assert.equal(textarea.value, 'Be brief.', 'Advanced opens on the saved instructions')
    const setValue = Object.getOwnPropertyDescriptor(dom.HTMLTextAreaElement.prototype, 'value')

    await act(() => {
      setValue?.set?.call(textarea, 'Be brief and kind.')
      textarea.dispatchEvent(new dom.Event('input', { bubbles: true }))
    })
    const form = container.querySelector('form')

    assert.ok(form)
    await act(async () => {
      form.dispatchEvent(new dom.Event('submit', { bubbles: true, cancelable: true }))
      // The face is saved first, then the instructions.
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    assert.deepEqual(saved, [['bot-1', '07-ada', 'team-1', 'mint']])
    assert.deepEqual(instructions, [['bot-1', 'Be brief and kind.', 'team-1']])
    assert.equal(agentAvatarBackground('bot-1'), 'mint')
    assert.equal(closed, true)
  } finally {
    await act(() => root.unmount())
  }
})
