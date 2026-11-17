import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { ConnectCardContextValue } from './connectCardContext'
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
    // The first option is the one filled button.
    assert.deepEqual(
      buttons().map((item) => [item.textContent, item.className.includes('bg-action-primary')]),
      [
        ['Merge', true],
        ['Wait', false],
        ['Other…', false],
        ['Skip', false],
      ],
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
    assert.match(container.textContent ?? '', /Skipped\. The agent carries on without an answer\./)
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
