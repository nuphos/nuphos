import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement, createRef } from 'react'

const reads = { members: 0, chats: 0 }

mock.module('../../../api.ts', () => ({
  api: {
    atlasListTeamMembers: async () => {
      reads.members++

      return [{ id: 'u1', name: 'Alice Chen', username: 'alice', email: 'alice@example.test' }]
    },
    agentListConversations: async (_teamId: string, options: { scope: string; kind?: string }) => {
      if (options.scope === 'mine' && !options.kind) reads.chats++

      return {
        conversations:
          options.scope === 'mine' && !options.kind
            ? [
                { sessionId: 'here', title: 'This chat', firstMessage: '', lastActiveAt: '' },
                { sessionId: 's1', title: 'Deploy agent', firstMessage: '', lastActiveAt: '' },
              ]
            : [],
      }
    },
  },
}))

// The menu as plain rows: what it is given to show, and nothing else.
mock.module('./composerMentionOptions', () => ({
  MentionPicker: ({ options }: { options: { kind: string; [key: string]: unknown }[] }) =>
    createElement(
      'ul',
      null,
      options.map((option, index) =>
        createElement(
          'li',
          { key: index },
          option.kind === 'member'
            ? (option.member as { name: string }).name
            : option.kind === 'device'
              ? (option.device as { label: string }).label
              : (option.session as { title: string }).title,
        ),
      ),
    ),
}))

mock.module('../../ui/alert-dialog', () => ({ AppAlertDialog: () => null }))
mock.module('../ComputerUseConfirm', () => ({ ComputerUseConfirm: () => null }))

// In short steps: React renders what the reads bring only as each `act` ends.
async function wait(ms: number) {
  for (let left = ms; left > 0; left -= 50)
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
}

test('every @ shows people, computers and chats at once, filtered without another read', async () => {
  const dom = new Window()
  const values = {
    window: dom,
    navigator: dom.navigator,
    document: dom.document,
    Node: dom.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  }
  const original = Object.keys(values).map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  )

  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  // After the window: the query library decides at import whether it runs on a server.
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
  const { useComposerMentions } = await import('./useComposerMentions')
  const { createRoot } = await import('react-dom/client')
  const document = dom.document as unknown as Document
  const container = document.createElement('div')
  const editor = document.createElement('div')

  document.body.append(container, editor)
  const editorRef = createRef<HTMLDivElement>() as { current: HTMLDivElement | null }

  editorRef.current = editor
  let onInput = () => {}
  const Probe = () => {
    const mentions = useComposerMentions(
      editorRef,
      () => {},
      { teamId: 'team', sessionId: 'here' },
      {
        options: { devices: [{ deviceId: 'd1', label: 'Build box', platform: 'linux' }] },
        value: { deviceIds: [] },
        onChange: () => {},
      } as never,
    )

    onInput = mentions.onInput

    return mentions.ui
  }
  /** Types `text` into the composer, caret at its end. */
  const type = async (text: string) => {
    editor.textContent = text
    const node = editor.firstChild as Text

    window.getSelection()?.collapse(node, text.length)
    await act(async () => onInput())
  }
  const root = createRoot(container)

  try {
    await act(() =>
      root.render(
        createElement(QueryClientProvider, { client: new QueryClient() }, createElement(Probe)),
      ),
    )
    // The composer reads what the menu offers as it opens, before any @.
    await wait(200)
    const before = { ...reads }

    await type('@')
    // The very render that answers the keystroke has every section.
    const menu = document.body.textContent ?? ''

    assert.match(menu, /Alice Chen/)
    assert.match(menu, /Build box/)
    assert.match(menu, /Deploy agent/)
    assert.doesNotMatch(menu, /This chat/, 'the chat being written in is not offered')

    await type('@dep')
    const filtered = document.body.textContent ?? ''

    assert.match(filtered, /Deploy agent/)
    assert.doesNotMatch(filtered, /Alice Chen/)
    await wait(200)
    assert.deepEqual(reads, before, 'typing reads nothing more')
  } finally {
    await act(() => root.unmount())
    await dom.happyDOM.close()
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete (globalThis as Record<string, unknown>)[key]
    }
  }
})
