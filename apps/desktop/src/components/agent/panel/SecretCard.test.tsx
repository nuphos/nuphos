import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { ConnectCardContextValue } from './connectCardContext'
import type { ReactNode } from 'react'

mock.module('../MessageResponse', () => ({
  MessageResponse: ({ children }: { children: ReactNode }) => createElement('div', null, children),
}))

const { SecretCard } = await import('./SecretCard')
const { ConnectCardContext } = await import('./connectCardContext')

test('a secret request can be dismissed instead of answered, and never sends a value', async () => {
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
  const sent: string[] = []
  const dismissed: string[] = []
  let withdrawn = false
  const ctx: ConnectCardContextValue = {
    send: (text) => {
      sent.push(text)

      return true
    },
    answer: () => true,
    dismiss: (card) => {
      dismissed.push(card.toolCallId)

      return Promise.resolve(withdrawn)
    },
    saveSecret: () => Promise.resolve('/secrets/TOKEN'),
  }
  const render = (value: ConnectCardContextValue) =>
    act(() =>
      root.render(
        createElement(
          ConnectCardContext.Provider,
          { value },
          createElement(SecretCard, {
            toolCallId: 's1',
            name: 'CLOUDFLARE_TOKEN',
            reason: 'To purge the cache.',
            state: 'open',
          }),
        ),
      ),
    )
  const button = (label: string) =>
    ([...container.querySelectorAll('button')] as unknown as HTMLButtonElement[]).find(
      (item) => item.textContent === label,
    )
  const click = (label: string) => act(async () => button(label)?.click())

  try {
    await render(ctx)
    assert.notEqual(button('Dismiss'), undefined)

    // A dismiss the server refused leaves the card as it was.
    await click('Dismiss')
    assert.deepEqual(dismissed, ['s1'])
    assert.notEqual(container.querySelector('input'), null)

    withdrawn = true
    await click('Dismiss')
    assert.match(container.textContent ?? '', /Dismissed\. It carries on without an answer\./)
    assert.equal(container.querySelector('input'), null)
    assert.equal(button('Dismiss'), undefined)
    // Declining sends nothing in the conversation: least of all a value.
    assert.deepEqual(sent, [])

    // Whoever cannot answer here is offered no Dismiss either.
    await act(() => root.unmount())
    const again = createRoot(container as unknown as HTMLElement)

    await act(() =>
      again.render(
        createElement(
          ConnectCardContext.Provider,
          { value: { ...ctx, answer: undefined } },
          createElement(SecretCard, {
            toolCallId: 's2',
            name: 'CLOUDFLARE_TOKEN',
            reason: 'To purge the cache.',
            state: 'open',
          }),
        ),
      ),
    )
    assert.equal(button('Dismiss'), undefined)
    await act(() => again.unmount())
  } finally {
    for (const [key, descriptor] of originals)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
  }
})

test('while a dismissal is in flight, the value cannot be sent', async () => {
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
  const saved: string[] = []
  // The server has not answered the dismissal yet.
  let release: (withdrawn: boolean) => void = () => undefined
  const ctx: ConnectCardContextValue = {
    send: () => true,
    answer: () => true,
    dismiss: () => new Promise<boolean>((resolve) => (release = resolve)),
    saveSecret: (name) => {
      saved.push(name)

      return Promise.resolve('/secrets/TOKEN')
    },
  }
  const button = (label: string) =>
    ([...container.querySelectorAll('button')] as unknown as HTMLButtonElement[]).find(
      (item) => item.textContent === label,
    )

  try {
    await act(() =>
      root.render(
        createElement(
          ConnectCardContext.Provider,
          { value: ctx },
          createElement(SecretCard, {
            toolCallId: 's1',
            name: 'CLOUDFLARE_TOKEN',
            reason: 'To purge the cache.',
            state: 'open',
          }),
        ),
      ),
    )
    await act(async () => {
      const input = container.querySelector('input') as unknown as HTMLInputElement
      const setValue = Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, 'value')?.set

      setValue?.call(input, 'secret-value')
      input.dispatchEvent(new dom.Event('input', { bubbles: true }) as unknown as Event)
    })
    await act(async () => button('Dismiss')?.click())
    assert.equal(button('Send securely')?.disabled, true)
    await act(async () => button('Send securely')?.click())
    assert.deepEqual(saved, [])

    await act(async () => release(true))
    assert.equal(container.querySelector('input'), null)
    assert.deepEqual(saved, [])
    await act(() => root.unmount())
  } finally {
    for (const [key, descriptor] of originals)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
  }
})
