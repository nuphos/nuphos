import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { RuntimeInstance } from '../../types/runtime'
import type { ReactNode } from 'react'

let runtime: RuntimeInstance | null = null
const created: unknown[] = []
const groups: unknown[][] = []

mock.module('../agent/panel/useNewConversationRuntime', () => ({
  useNewConversationRuntime: () => ({
    newConversationRuntime: runtime,
    runtimeInstancesLoading: false,
    runtimeInstancesError: null,
  }),
}))
mock.module('../../api', () => ({
  api: {
    agentCreateBot: (_team: string, bot: unknown) => {
      created.push(bot)

      return Promise.resolve({ sessionId: 'made-bot' })
    },
    agentCreateChannel: (team: string, group?: boolean) => {
      groups.push([team, group])

      return Promise.resolve({ sessionId: 'made-group' })
    },
  },
}))
mock.module('../channels/channelKind', () => ({ markChannel: () => {} }))
// The menu as plain elements, as Modal is below: its items are always rendered.
mock.module('../ui/menu', () => ({
  Menu: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  MenuTrigger: ({ children, ...props }: { children: ReactNode }) =>
    createElement('button', { type: 'button', ...props }, children),
  MenuContent: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  MenuItem: ({ children, onClick }: { children: ReactNode; onClick: () => void }) =>
    createElement('div', { role: 'menuitem', onClick }, children),
}))
mock.module('../../lib/agentAvatarChoices', () => ({ receiveAgentAvatars: () => {} }))
mock.module('../ui/toast', () => ({ toast: { apiError: () => {} } }))
mock.module('../channels/botChannel', () => ({
  createBotChannel: () => Promise.resolve('made-chat'),
}))
mock.module('../channels/BotImportDialog', () => ({ BotImportDialog: () => null }))
mock.module('../Modal', () => ({
  Modal: ({ children, title }: { children: ReactNode; title: string }) =>
    createElement('div', { 'data-modal': title }, children),
}))
mock.module('../../views/onboarding/setup/LocalAgentsStep', () => ({
  LocalAgentSetupCards: () => createElement('div', null, 'Connect an agent here'),
}))
mock.module('../agent/BotAvatarImage', () => ({ BotAvatarImage: () => createElement('img') }))
mock.module('../agent/AgentAvatarGrid', () => ({
  AgentAvatarGrid: ({ onChange }: { onChange: (file: string) => void }) =>
    createElement(
      'button',
      { type: 'button', 'data-pick-avatar': true, onClick: () => onChange('03-mona-lisa.svg') },
      'Avatar',
    ),
}))

const { NewChatButton } = await import('./NewChatButton')

test('connect before creating, preserving the name and avatar when returning to the form', async () => {
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
  const opened: string[] = []
  const render = () =>
    act(() =>
      root.render(
        createElement(NewChatButton, {
          teamId: 'team',
          onCreated: (id) => opened.push(id),
        }),
      ),
    )
  const click = async (selector: string) =>
    act(() => (container.querySelector(selector) as unknown as HTMLElement).click())
  // "+" opens a menu of New Bot and New Group Chat.
  const pick = async (label: string) => {
    const item = [...container.querySelectorAll('[role="menuitem"]')].find((one) =>
      one.textContent?.includes(label),
    ) as unknown as HTMLElement

    await act(() => item.click())
  }
  const submit = async () =>
    act(async () => {
      container
        .querySelector('form')!
        .dispatchEvent(new dom.Event('submit', { bubbles: true, cancelable: true }))
    })

  try {
    await render()
    await pick('New Bot')
    const input = container.querySelector('input')!
    const form = container.querySelector('form')!

    await act(() => {
      Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, 'value')!.set!.call(
        input,
        'Helper',
      )
      input.dispatchEvent(new dom.Event('input', { bubbles: true }))
    })
    await click('[data-pick-avatar]')
    await submit()
    assert.equal(created.length, 0, 'no Bot shell is created before an agent exists')
    assert.ok(container.querySelector('[data-modal="Connect your agent"]'))
    assert.ok(form.closest('[hidden]'))
    const back = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Back',
    )!

    await act(() => back.click())
    assert.equal(container.querySelector('form'), form, 'the draft form remains mounted')
    assert.equal(container.querySelector('input')!.value, 'Helper')
    runtime = {
      id: 'ready-runtime',
      provider: 'codex',
      label: 'Codex',
      kind: 'managed',
      status: 'active',
      createdAt: '',
    }
    await render()
    await submit()
    assert.deepEqual(created, [
      {
        title: 'Helper',
        avatar: '03-mona-lisa',
        runtimeId: 'ready-runtime',
        agentRuntime: 'codex',
        runtimeLabel: 'Codex',
      },
    ])
    assert.deepEqual(opened, ['made-chat'])
    // New Group Chat makes an empty chat marked as a group and opens it.
    await pick('New Group Chat')
    await act(async () => {})
    assert.deepEqual(groups, [['team', true]])
    assert.deepEqual(opened, ['made-chat', 'made-group'])
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
