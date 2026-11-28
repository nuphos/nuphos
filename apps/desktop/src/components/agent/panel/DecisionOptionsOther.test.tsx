import assert from 'node:assert/strict'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { DecisionQuestion } from './decisionFormModel'
import type { DecisionAnswer } from '../../../api/agent-chat-types'

const { DecisionOptions } = await import('./DecisionOptions')

const questions: DecisionQuestion[] = [
  { question: 'Delete the recordings?', options: ['Delete', 'Keep'], multiSelect: false },
  { question: 'Add a cloud backup?', options: ['GCP bucket', 'Not yet'], multiSelect: false },
]

// #5257: "Other…" on two questions keeps both answers, and an option picked before "Other…" does
// not stay shown as picked while the words are what is sent.
test('Other typed on two questions keeps both answers, and the card shows what it sends', async () => {
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
  const answers: DecisionAnswer[] = []
  const sets = () => [...container.querySelectorAll('fieldset')]
  const click = (at: number, label: string) =>
    act(async () =>
      [...(sets()[at]?.querySelectorAll('button') ?? [])]
        .find((b) => b.textContent === label)
        ?.click(),
    )
  const type = (at: number, text: string) =>
    act(async () => {
      const input = sets()[at]?.querySelector('input') as unknown as HTMLInputElement
      const setValue = Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, 'value')?.set

      setValue?.call(input, text)
      input.dispatchEvent(new dom.Event('input', { bubbles: true }) as unknown as Event)
    })
  const send = () =>
    [...container.querySelectorAll('button')].find((b) => b.textContent === 'Send') as unknown as
      HTMLButtonElement | undefined

  try {
    await act(() =>
      root.render(
        createElement(
          QueryClientProvider,
          { client: new QueryClient() },
          createElement(DecisionOptions, {
            questions,
            disabled: false,
            typeable: true,
            onSubmit: (answer: DecisionAnswer) => answers.push(answer),
          }),
        ),
      ),
    )
    await click(0, 'Delete')
    await click(0, 'Other…')
    await type(0, 'only the old ones')
    await click(1, 'Other…')
    await type(1, 'maybe google drive?')

    const deleteShownPicked = [...(sets()[0]?.querySelectorAll('button') ?? [])].some(
      (b) => b.textContent === 'Delete' && b.querySelector('svg'),
    )

    assert.equal(deleteShownPicked, false, '"Delete" is not shown picked once Other is')
    assert.equal(send()?.disabled, false, 'Send can be pressed')
    await act(async () => send()?.click())
    assert.deepEqual(answers, [
      { questions: [{ text: 'only the old ones' }, { text: 'maybe google drive?' }] },
    ])
  } finally {
    await act(() => root.unmount())
    for (const [key, descriptor] of originals)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
  }
})
