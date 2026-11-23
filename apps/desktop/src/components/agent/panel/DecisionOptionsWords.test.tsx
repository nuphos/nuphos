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
  { question: 'Add a microphone picker?', options: ['Yes', 'No'], multiSelect: false },
]

test("in a card of several questions, a field's button keeps its words as that question's answer until the card is complete, then sends it", async () => {
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
  const buttonsOf = (at: number) =>
    [...(sets()[at]?.querySelectorAll('button') ?? [])] as unknown as HTMLButtonElement[]
  const click = (at: number, label: string) =>
    act(async () =>
      buttonsOf(at)
        .find((b) => b.textContent === label)
        ?.click(),
    )
  const fieldButton = (at: number) =>
    sets()[at]?.querySelector('form button[type="submit"]') as unknown as
      HTMLButtonElement | undefined
  const type = (at: number, text: string) =>
    act(async () => {
      const input = sets()[at]?.querySelector('input') as unknown as HTMLInputElement
      const setValue = Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, 'value')?.set

      setValue?.call(input, text)
      input.dispatchEvent(new dom.Event('input', { bubbles: true }) as unknown as Event)
    })
  // Enter in the field: the form's own submit.
  const enter = (at: number) =>
    act(async () => {
      const form = sets()[at]?.querySelector('form') as unknown as HTMLFormElement

      form.dispatchEvent(
        new dom.Event('submit', { bubbles: true, cancelable: true }) as unknown as Event,
      )
    })

  // The field reads the team's role (for dictation) through react-query.
  const client = new QueryClient()
  const show = (key: string) =>
    act(() =>
      root.render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(DecisionOptions, {
            key,
            questions,
            disabled: false,
            typeable: true,
            onSubmit: (answer: DecisionAnswer) => answers.push(answer),
          }),
        ),
      ),
    )

  try {
    for (const press of ['click', 'enter'] as const) {
      answers.length = 0
      await show(press)
      await click(0, 'Delete')
      await click(1, 'Other…')
      await type(1, 'maybe google drive?')
      // A question is still open, so the field's button says what it does: Done, not Send.
      assert.match(fieldButton(1)?.textContent ?? '', /^Done/)
      assert.equal(fieldButton(1)?.disabled, false)
      if (press === 'click') await act(async () => fieldButton(1)?.click())
      else await enter(1)
      // It did something: the field closed, and its pill shows the words, picked.
      assert.equal(sets()[1]?.querySelector('input'), null, `${press} closes the field`)
      assert.ok(
        buttonsOf(1).some((b) => b.textContent === 'maybe google drive?'),
        `${press} keeps the words`,
      )
      assert.deepEqual(answers, [], 'nothing is sent while a question is unanswered')

      // Once the last is answered, the card's Send sends the words as that question's answer.
      await click(2, 'No')
      await click(2, 'Send')
      assert.deepEqual(answers, [
        {
          questions: [
            { choices: ['Delete'] },
            { text: 'maybe google drive?' },
            { choices: ['No'] },
          ],
        },
      ])
    }

    // With every other question answered, the field's button is Send and answers the card.
    answers.length = 0
    await show('complete')
    await click(0, 'Keep')
    await click(2, 'Yes')
    await click(1, 'Other…')
    await type(1, 'Drive')
    assert.match(fieldButton(1)?.textContent ?? '', /^Send/)
    await enter(1)
    assert.deepEqual(answers, [
      { questions: [{ choices: ['Keep'] }, { text: 'Drive' }, { choices: ['Yes'] }] },
    ])
  } finally {
    await act(() => root.unmount())
    for (const [key, descriptor] of originals)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
  }
})
