import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

const decided: unknown[][] = []
let refuse = false

mock.module('../../api', () => ({
  api: {
    agentDecideToolApproval: (...args: unknown[]) => {
      decided.push(args)

      return refuse ? Promise.reject(new Error('request_expired')) : Promise.resolve({ ok: true })
    },
  },
}))

const { BotChatToolApproval } = await import('./BotChatToolApproval')

test('the owner allows or denies a waiting tool call from the Bot chat', async () => {
  const dom = new Window()
  const values = {
    window: dom,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
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
  const render = (waitId: string) =>
    act(() =>
      root.render(
        createElement(BotChatToolApproval, {
          key: waitId,
          teamId: 'team',
          botId: 'bot',
          approval: { waitId, toolCallId: 'call-1', title: 'kubectl delete pod web', at: 1 },
        }),
      ),
    )
  const buttons = () => [...container.querySelectorAll('button')] as unknown as HTMLElement[]

  try {
    await render('w1')
    assert.match(container.textContent ?? '', /kubectl delete pod web/)
    await act(async () => buttons()[0]!.click())
    assert.deepEqual(decided, [['bot', 'call-1', 'team', 'allow']])
    // Sent, the card leaves at once; the runtime drops the request after.
    assert.equal(buttons().length, 0)

    await render('w2')
    refuse = true
    await act(async () => buttons()[1]!.click())
    assert.deepEqual(decided.at(-1), ['bot', 'call-1', 'team', 'reject'])
    // Refused, it comes back to be answered again.
    assert.equal(buttons().length, 2)
  } finally {
    await act(() => root.unmount())
    for (const [key, descriptor] of originals)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
  }
})
