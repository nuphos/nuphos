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

const regions: DecisionQuestion = {
  question: 'Which regions?',
  options: ['us', 'eu'],
  multiSelect: true,
}

test('a form: Other is a pick with its field under it, one footer Send counts what is left, Return sends only when complete', async () => {
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
  const pill = (at: number, label: string) => buttonsOf(at).find((b) => b.textContent === label)
  const click = (at: number, label: string) => act(async () => pill(at, label)?.click())
  const checked = (at: number) =>
    buttonsOf(at)
      .filter((b) => b.getAttribute('aria-checked') === 'true')
      .map((b) => b.textContent)
  const footer = () =>
    [...container.querySelectorAll('button')].at(-1) as unknown as HTMLButtonElement
  const field = (at: number) =>
    sets()[at]?.querySelector('input') as unknown as HTMLInputElement | null
  const type = (at: number, text: string) =>
    act(async () => {
      const input = field(at) as HTMLInputElement
      const setValue = Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, 'value')?.set

      setValue?.call(input, text)
      input.dispatchEvent(new dom.Event('input', { bubbles: true }) as unknown as Event)
    })
  // Return in the field: the form's own submit.
  const enter = (at: number) =>
    act(async () => {
      const form = sets()[at]?.querySelector('form') as unknown as HTMLFormElement

      form.dispatchEvent(
        new dom.Event('submit', { bubbles: true, cancelable: true }) as unknown as Event,
      )
    })

  // The field reads the team's role (for dictation) through react-query.
  const client = new QueryClient()
  const show = (key: string, list: DecisionQuestion[]) =>
    act(() =>
      root.render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(
            DecisionOptions,
            {
              key,
              questions: list,
              disabled: false,
              typeable: true,
              onSubmit: (answer: DecisionAnswer) => answers.push(answer),
            },
            createElement('button', { type: 'button' }, 'Dismiss'),
          ),
        ),
      ),
    )

  try {
    await show('three', questions)
    // One footer after every question: the card's own actions, then the send button, last.
    assert.equal(footer().textContent, 'Answer 3 more')
    assert.equal(footer().disabled, true)
    assert.equal(
      container.lastElementChild?.lastElementChild?.querySelector('button')?.textContent,
      'Dismiss',
    )
    // Each question's header: its number, until answered.
    assert.deepEqual(
      sets().map((set) => set.querySelector('legend')?.textContent),
      ['1Delete the recordings?', '2Add a cloud backup?', '3Add a microphone picker?'],
    )

    await click(0, 'Delete')
    assert.equal(footer().textContent, 'Answer 2 more')
    assert.equal(sets()[0]?.querySelector('legend')?.textContent, 'Delete the recordings?')

    // Other is picked like an option: its field opens under it, with no button of its own.
    await click(1, 'GCP bucket')
    await click(1, 'Other…')
    assert.deepEqual(checked(1), ['Other'])
    assert.ok(field(1), 'the field opens')
    assert.equal(sets()[1]?.querySelector('form button[type="submit"]'), null)
    // Picked, with nothing typed, it does not answer.
    assert.equal(footer().textContent, 'Answer 2 more')
    await type(1, 'maybe google drive?')
    assert.equal(footer().textContent, 'Answer 1 more')
    // Return does nothing while a question is unanswered.
    await enter(1)
    assert.deepEqual(answers, [])

    // Other on another question: the first field's words stay.
    await click(2, 'Other…')
    await type(2, 'later')
    assert.equal(field(1)?.value, 'maybe google drive?')
    assert.equal(footer().textContent, 'Send')
    assert.equal(footer().disabled, false)

    // An option unpicks Other and closes its field; Other picked again has its words back.
    await click(2, 'Yes')
    assert.deepEqual(checked(2), ['Yes'])
    assert.equal(field(2), null)
    await click(2, 'Other…')
    assert.equal(field(2)?.value, 'later')
    await click(2, 'Other')
    assert.deepEqual(checked(2), [])
    assert.equal(footer().textContent, 'Answer 1 more')
    await click(2, 'No')

    // Return in a field sends the complete card: words or picks per question, never both.
    await enter(1)
    assert.deepEqual(answers, [
      {
        questions: [{ choices: ['Delete'] }, { text: 'maybe google drive?' }, { choices: ['No'] }],
      },
    ])

    // Multi-select: Other is exclusive with the options both ways.
    answers.length = 0
    await show('multi', [regions])
    assert.equal(sets()[0]?.querySelector('legend'), null, 'one question has no header')
    await click(0, 'us')
    await click(0, 'eu')
    assert.deepEqual(checked(0), ['us', 'eu'])
    await click(0, 'Other…')
    assert.deepEqual(checked(0), ['Other'])
    await type(0, 'Tokyo')
    await click(0, 'eu')
    assert.deepEqual(checked(0), ['eu'])
    assert.equal(field(0), null)
    await act(async () => footer().click())
    assert.deepEqual(answers, [{ choices: ['eu'] }])

    // Several questions, one multi-select: "Choose any" trails its header.
    await show('choose-any', [regions, questions[0] as DecisionQuestion])
    assert.equal(sets()[0]?.querySelector('legend')?.textContent, '1Which regions?Choose any')
  } finally {
    await act(() => root.unmount())
    for (const [key, descriptor] of originals)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
  }
})
