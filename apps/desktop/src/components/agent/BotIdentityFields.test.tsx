import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'

mock.module('./AgentAvatarGrid', () => ({ AgentAvatarGrid: () => null }))
mock.module('./BotAvatarImage', () => ({ BotAvatarImage: () => null }))
const { BotIdentityFields } = await import('./BotIdentityFields')

const ignore = () => {
  /* not under test */
}

test('Escape from the focused name reaches the modal while other shortcuts stay local', async () => {
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
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)
  const reached: string[] = []

  dom.document.addEventListener('keydown', (event) => reached.push(event.key))
  try {
    await act(() =>
      root.render(
        createElement(BotIdentityFields, {
          name: 'Sample Bot',
          onNameChange: ignore,
          avatar: '07-ada.svg',
          onAvatarChange: ignore,
          busy: false,
          submitLabel: 'Save',
        }),
      ),
    )
    const input = container.querySelector('input')

    assert.ok(input)

    input.focus()
    for (const key of ['a', 'Enter', 'Escape']) {
      await act(() => {
        input.dispatchEvent(new dom.KeyboardEvent('keydown', { key, bubbles: true }))
      })
    }
    assert.deepEqual(reached, ['Escape'])
  } finally {
    await act(() => root.unmount())
    await dom.happyDOM.close()
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})
