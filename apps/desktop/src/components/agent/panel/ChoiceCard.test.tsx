import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { ConnectCardContextValue } from './connectCardContext'
import type { DecisionQuestion } from './decisionFormModel'
import type { DecisionAnswer } from '../../../api/agent-chat-types'
import type { ReactNode } from 'react'

mock.module('../MessageResponse', () => ({
  MessageResponse: ({ children }: { children: ReactNode }) => createElement('div', null, children),
}))

const { ChoiceCard } = await import('./ChoiceCard')
const { ConnectCardContext } = await import('./connectCardContext')

test('the card leads with its question, answers with its buttons, and is skipped inside itself', async () => {
  const dom = new Window()
  const values = {
    window: dom,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    HTMLInputElement: dom.HTMLInputElement,
    HTMLTextAreaElement: dom.HTMLTextAreaElement,
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
  const skipped: string[] = []
  // Whether the server withdraws the question the card skips.
  let withdrawn = false
  const ctx: ConnectCardContextValue = {
    send: () => true,
    // Refused, so the card stays open for the next step.
    answer: (answer) => {
      answers.push(answer)

      return false
    },
    skip: (card) => {
      skipped.push(card.toolCallId)

      return Promise.resolve(withdrawn)
    },
    source: createElement('span', null, 'Release notes · 5:52 PM'),
  }
  const render = (value: ConnectCardContextValue | null, canAct = true) =>
    act(() =>
      root.render(
        createElement(
          ConnectCardContext.Provider,
          { value },
          createElement(ChoiceCard, {
            toolCallId: 'q1',
            category: 'approval',
            question: 'Merge the release branch?',
            body: 'CI is green.',
            options: ['Merge', 'Wait'],
            canAct,
          }),
        ),
      ),
    )
  const buttons = () => [...container.querySelectorAll('button')] as unknown as HTMLButtonElement[]
  const button = (label: string) => buttons().find((item) => item.textContent === label)
  // Async, so what an answer or a skip settles is drawn before the next assertion.
  const click = (label: string) => act(async () => button(label)?.click())

  try {
    await render(ctx)
    // Who asked, then the question as the heading: no category label over it.
    assert.equal(container.querySelector('h3')?.textContent, 'Merge the release branch?')
    // The question is one line, cut with an ellipsis, never wrapped across several.
    assert.match(container.querySelector('h3')?.className ?? '', /\btruncate\b/)
    assert.doesNotMatch(container.querySelector('h3')?.className ?? '', /whitespace-pre-wrap/)
    assert.match(container.textContent ?? '', /^Release notes · 5:52 PMMerge the release branch\?/)
    assert.doesNotMatch(container.textContent ?? '', /Approval needed|Agent:/)
    // Every option the same pill, none filled; "Other…" and "Skip" a line of text under them.
    assert.deepEqual(
      buttons().map((item) => [item.textContent, item.className.includes('bg-action-primary')]),
      [
        ['Merge', false],
        ['Wait', false],
        ['Other…', false],
        ['Skip', false],
      ],
    )
    assert.equal(
      buttons()[0]?.className.replace('Merge', ''),
      buttons()[1]?.className,
      'the options are one style',
    )

    await click('Wait')
    assert.deepEqual(answers, [{ choices: ['Wait'] }])

    // "Other…" opens the field under the options, which stay.
    assert.equal(container.querySelector('input'), null)
    await click('Other…')
    assert.notEqual(container.querySelector('input'), null)
    assert.notEqual(button('Merge'), undefined)
    // Esc closes it and keeps what was typed for when it opens again.
    await act(async () => {
      const input = container.querySelector('input') as unknown as HTMLInputElement
      const setValue = Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, 'value')?.set

      setValue?.call(input, 'After the freeze')
      input.dispatchEvent(new dom.Event('input', { bubbles: true }) as unknown as Event)
    })
    await act(async () => {
      container
        .querySelector('input')
        ?.dispatchEvent(new dom.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    assert.equal(container.querySelector('input'), null)
    await click('Other…')
    assert.equal(container.querySelector('input')?.value, 'After the freeze')

    // A skip the server refused leaves the card live, and claims nothing.
    await click('Skip')
    assert.deepEqual(skipped, ['q1'])
    assert.notEqual(button('Skip'), undefined)
    assert.doesNotMatch(container.textContent ?? '', /Skipped/)

    withdrawn = true
    await click('Skip')
    assert.deepEqual(skipped, ['q1', 'q1'])
    // Withdrawn: it says so, and nothing on it answers or skips any more.
    assert.match(container.textContent ?? '', /Skipped\. It carries on without an answer\./)
    assert.equal(button('Skip'), undefined)
    assert.equal(button('Other…'), undefined)
    assert.equal(button('Merge')?.disabled, true)

    // A card that cannot be answered here offers neither, and one from this chat names no source.
    await render({ ...ctx, source: undefined }, false)
    assert.equal(button('Skip'), undefined)
    assert.match(container.textContent ?? '', /^Merge the release branch\?/)
  } finally {
    await act(() => root.unmount())
    for (const [key, descriptor] of originals)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
  }
})

test('a single- and a multi-select question are one option row: multiSelect only picks any number and sends them', async () => {
  const dom = new Window()
  const values = {
    window: dom,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    HTMLInputElement: dom.HTMLInputElement,
    HTMLTextAreaElement: dom.HTMLTextAreaElement,
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
  const ctx: ConnectCardContextValue = {
    send: () => true,
    answer: (answer) => {
      answers.push(answer)

      return false
    },
    skip: () => Promise.resolve(false),
  }
  const render = (multiSelect: boolean, questions?: DecisionQuestion[]) =>
    act(() =>
      root.render(
        createElement(
          ConnectCardContext.Provider,
          { value: ctx },
          createElement(ChoiceCard, {
            key: `${String(multiSelect)}${String(questions?.length)}`,
            toolCallId: 'q1',
            category: 'preference',
            question: 'Which regions first?',
            options: ['us-east', 'eu-west', 'ap-northeast'],
            multiSelect,
            questions,
            canAct: true,
          }),
        ),
      ),
    )
  const buttons = () => [...container.querySelectorAll('button')] as unknown as HTMLButtonElement[]
  const button = (label: string) => buttons().find((item) => item.textContent === label)
  const click = (label: string) => act(async () => button(label)?.click())
  const row = () => buttons().map((item) => item.textContent)

  try {
    await render(false)
    const single = row()

    // One row: the options, "Other…" and "Skip"; no field until "Other…" opens one.
    assert.deepEqual(single, ['us-east', 'eu-west', 'ap-northeast', 'Other…', 'Skip'])
    assert.equal(container.querySelector('input'), null)
    await click('eu-west')
    assert.deepEqual(answers, [{ choices: ['eu-west'] }])

    await render(true)
    // The same pills and line, with Send for the picks.
    assert.deepEqual(row(), ['us-east', 'eu-west', 'ap-northeast', 'Other…', 'Skip', 'Send'])
    assert.equal(container.querySelector('input'), null)
    // Its options are checkboxes: a click picks, and only Send answers.
    assert.deepEqual(
      [...container.querySelectorAll('[role="checkbox"]')].map((item) => item.textContent),
      ['us-east', 'eu-west', 'ap-northeast'],
    )
    assert.equal(button('Send')?.disabled, true)
    await click('us-east')
    await click('ap-northeast')
    assert.equal(answers.length, 1)
    assert.equal(button('us-east')?.getAttribute('aria-checked'), 'true')
    assert.equal(button('eu-west')?.getAttribute('aria-checked'), 'false')
    await click('Send')
    assert.deepEqual(answers.at(-1), { choices: ['us-east', 'ap-northeast'] })

    // One entry in `questions` with its own multiSelect, the top level saying nothing of it:
    // its own options, as checkboxes, and a key never answers them.
    await render(false, [
      { question: 'Which regions first?', options: ['x', 'y'], multiSelect: true },
    ])
    assert.deepEqual(row(), ['x', 'y', 'Other…', 'Skip', 'Send'])
    assert.equal(container.querySelectorAll('[role="checkbox"]').length, 2)
    const sent = answers.length

    await act(async () => {
      dom.document.dispatchEvent(
        new dom.KeyboardEvent('keydown', {
          key: '1',
          code: 'Digit1',
          ctrlKey: true,
          altKey: true,
          bubbles: true,
        }) as unknown as Event,
      )
    })
    assert.equal(answers.length, sent)
  } finally {
    await act(() => root.unmount())
    for (const [key, descriptor] of originals)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
  }
})
