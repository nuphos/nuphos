import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { ChannelAgent } from '../../api'

// A question asked the day before: the line shows it with no time.
mock.module('./useBotWork', () => ({
  useBotWork: () => ({
    work: { kind: 'asking', question: 'Connect Sentry?', kids: [] },
    since: undefined,
  }),
  useTicking: () => Date.now(),
}))
mock.module('../agent/AgentAvatar', () => ({ AgentAvatar: () => null }))

const { BotWorkStatus } = await import('./BotWorkStatus')

test('the line asking for input brings its question card into view', async () => {
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
  let shown = 0
  const render = (onShowQuestion?: () => void) =>
    act(() =>
      root.render(
        createElement(BotWorkStatus, {
          teamId: 'team',
          channelId: 'c',
          agent: { sessionId: 'bot' } as ChannelAgent,
          onShowQuestion,
        }),
      ),
    )

  try {
    await render(() => {
      shown += 1
    })
    const line = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Connect Sentry?'),
    ) as unknown as HTMLElement

    assert.ok(line)
    await act(() => line.click())
    assert.equal(shown, 1)
    assert.doesNotMatch(container.textContent ?? '', /:\d\d/)
    // Where there is no card to bring into view, the line is only words.
    await render()
    assert.equal(container.querySelectorAll('button').length, 0)
    assert.match(container.textContent ?? '', /Connect Sentry\?/)
  } finally {
    await act(() => root.unmount())
    for (const [key, descriptor] of originals)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
  }
})
