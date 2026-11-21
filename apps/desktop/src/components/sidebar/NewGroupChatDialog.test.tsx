import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { ReactNode } from 'react'

const calls: unknown[][] = []

mock.module('../../api', () => ({
  api: {
    atlasListTeamMembers: () =>
      Promise.resolve([
        { id: 'me', name: 'Me', email: 'me@example.com' },
        { id: 'richard', name: 'Richard', email: 'richard@example.com' },
      ]),
    agentCreateChannel: (...args: unknown[]) => {
      calls.push(['create', ...args])

      return Promise.resolve({ sessionId: 'made-group' })
    },
    agentInviteConversationParticipants: (...args: unknown[]) => {
      calls.push(['invite', ...args])

      return Promise.resolve({ participants: [], generalAccess: 'none' })
    },
    agentAddChannelAgent: (...args: unknown[]) => {
      calls.push(['agent', ...args])

      return Promise.resolve()
    },
  },
}))
mock.module('../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'me' }) }))
mock.module('../agent/channelPeople', () => ({
  addableAgents: () => [{ id: 'support-bot', name: 'Support Lead', email: '', agent: {} }],
}))
mock.module('../channels/channelKind', () => ({ markChannel: () => null }))
mock.module('../ui/toast', () => ({ toast: { apiError: () => null } }))
mock.module('../Modal', () => ({
  Modal: ({ children, title }: { children: ReactNode; title: string }) =>
    createElement('div', { 'data-modal': title }, children),
}))
// The picker as one button per person, so a test can pick by name.
mock.module('../agent/TeammatePicker', () => ({
  TeammatePicker: ({
    invitable,
    onToggle,
  }: {
    invitable: { id: string; name: string }[]
    onToggle: (member: { id: string; name: string }) => void
  }) =>
    createElement(
      'div',
      null,
      invitable.map((member) =>
        createElement(
          'button',
          {
            key: member.id,
            type: 'button',
            'data-pick': member.id,
            onClick: () => onToggle(member),
          },
          member.name,
        ),
      ),
    ),
}))

const { NewGroupChatDialog } = await import('./NewGroupChatDialog')

async function mount() {
  const dom = new Window()
  const values = {
    window: dom,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    HTMLInputElement: dom.HTMLInputElement,
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
  let closed = 0

  await act(async () =>
    root.render(
      createElement(NewGroupChatDialog, {
        teamId: 'team',
        onClose: () => closed++,
        onCreated: (id: string) => opened.push(id),
      }),
    ),
  )
  const el = (selector: string) => container.querySelector(selector) as unknown as HTMLElement

  return {
    opened,
    closed: () => closed,
    click: (selector: string) => act(async () => el(selector).click()),
    type: (value: string) =>
      act(async () => {
        const input = el('input[aria-label="Group chat name"]') as HTMLInputElement
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')
          ?.set as (v: string) => void

        setter.call(input, value)
        input.dispatchEvent(new dom.Event('input', { bubbles: true }) as unknown as Event)
      }),
    has: (selector: string) => container.querySelector(selector) !== null,
    unmount: async () => {
      await act(() => root.unmount())
      await dom.happyDOM.close()
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else Reflect.deleteProperty(globalThis, key)
      }
    },
  }
}

test('Create makes the chat with its name and members, then opens it', async () => {
  calls.length = 0
  const ui = await mount()

  try {
    // The viewer is in every chat they make, so they are not offered.
    assert.equal(ui.has('[data-pick="me"]'), false)
    await ui.type('  Launch  ')
    await ui.click('[data-pick="richard"]')
    await ui.click('[data-pick="support-bot"]')
    assert.deepEqual(calls, [])
    await ui.click('button[type="submit"]')
    assert.deepEqual(calls, [
      ['create', 'team', true, 'Launch'],
      ['invite', 'made-group', 'team', ['richard'], false],
      ['agent', 'made-group', 'team', 'support-bot'],
    ])
    assert.deepEqual(ui.opened, ['made-group'])
  } finally {
    await ui.unmount()
  }
})

test('an empty name leaves the chat to be called by its members', async () => {
  calls.length = 0
  const ui = await mount()

  try {
    await ui.click('button[type="submit"]')
    assert.deepEqual(calls, [['create', 'team', true, '']])
    assert.deepEqual(ui.opened, ['made-group'])
  } finally {
    await ui.unmount()
  }
})

test('Cancel creates nothing', async () => {
  calls.length = 0
  const ui = await mount()

  try {
    await ui.type('Launch')
    await ui.click('[data-pick="richard"]')
    await ui.click('[data-cancel]')
    assert.deepEqual(calls, [])
    assert.equal(ui.closed(), 1)
    assert.deepEqual(ui.opened, [])
  } finally {
    await ui.unmount()
  }
})
