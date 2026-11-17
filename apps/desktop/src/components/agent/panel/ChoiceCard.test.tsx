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

test('the card leads with its question, answers with its buttons, and is snoozed or dismissed with them', async () => {
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
  const dismissed: string[] = []
  // Whether the server withdraws the question the card dismisses.
  let withdrawn = false
  const ctx: ConnectCardContextValue = {
    send: () => true,
    // Refused, so the card stays open for the next step.
    answer: (answer) => {
      answers.push(answer)

      return false
    },
    dismiss: (card) => {
      dismissed.push(card.toolCallId)

      return Promise.resolve(withdrawn)
    },
    // Only its owner snoozes a question, so a card is given this only for them.
    snooze: () => {},
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
  // Async, so what an answer or a dismiss settles is drawn before the next assertion.
  const click = (label: string) => act(async () => button(label)?.click())

  try {
    await render(ctx)
    // Who asked, then the question as the heading: no category label over it.
    assert.equal(container.querySelector('h3')?.textContent, 'Merge the release branch?')
    assert.match(container.textContent ?? '', /^Release notes · 5:52 PMMerge the release branch\?/)
    assert.doesNotMatch(container.textContent ?? '', /Approval needed|Agent:/)
    // The first option is the one filled button; Snooze and Dismiss follow in the same row.
    assert.deepEqual(
      buttons().map((item) => [item.textContent, item.className.includes('bg-action-primary')]),
      [
        ['Merge', true],
        ['Wait', false],
        ['Other…', false],
        ['Snooze', false],
        ['Dismiss', false],
      ],
    )
    // They are option buttons like Wait, not small text beside the row.
    assert.equal(button('Snooze')?.className, button('Wait')?.className)
    // Snooze and Dismiss each lead with an icon, which tells them from the answers.
    assert.notEqual(button('Snooze')?.querySelector('svg'), null)
    assert.notEqual(button('Dismiss')?.querySelector('svg'), null)
    assert.equal(button('Wait')?.querySelector('svg'), null)
    // So is "Other…": every way to deal with the question is a button of the same kind.
    assert.equal(button('Other…')?.className, button('Wait')?.className)
    assert.equal(button('Dismiss')?.className, button('Wait')?.className)
    assert.equal(button('Snooze')?.parentElement, button('Wait')?.parentElement)
    // A viewer who is not its owner is offered no Snooze.
    await render({ ...ctx, snooze: undefined })
    assert.equal(button('Snooze'), undefined)
    assert.notEqual(button('Dismiss'), undefined)
    await render(ctx)

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

    // A dismiss the server refused leaves the card live, and claims nothing.
    await click('Dismiss')
    assert.deepEqual(dismissed, ['q1'])
    assert.notEqual(button('Dismiss'), undefined)
    assert.doesNotMatch(container.textContent ?? '', /Dismissed/)

    withdrawn = true
    await click('Dismiss')
    assert.deepEqual(dismissed, ['q1', 'q1'])
    // Withdrawn: it says so, and nothing on it answers or dismisses any more.
    assert.match(
      container.textContent ?? '',
      /Dismissed\. The agent carries on without an answer\./,
    )
    assert.equal(button('Dismiss'), undefined)
    assert.equal(button('Other…'), undefined)
    assert.equal(button('Merge')?.disabled, true)

    // A card that cannot be answered here offers neither, and one from this chat names no source.
    await render({ ...ctx, source: undefined }, false)
    assert.equal(button('Dismiss'), undefined)
    assert.equal(button('Snooze'), undefined)
    assert.match(container.textContent ?? '', /^Merge the release branch\?/)
  } finally {
    await act(() => root.unmount())
    for (const [key, descriptor] of originals)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
  }
})
