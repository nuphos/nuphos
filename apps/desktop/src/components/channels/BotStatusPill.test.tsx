import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, cloneElement, createElement } from 'react'

import type { BotWork } from './botWork'
import type { ReactElement, ReactNode } from 'react'

let reading: { work: BotWork | null; since: number | undefined } = { work: null, since: undefined }
const shown: string[] = []

mock.module('./useBotWork', () => ({ useBotWork: () => reading, useTicking: () => 60_000 }))
mock.module('./useBotChatQuestions', () => ({
  showBotQuestion: (_chat: unknown, _team: string, id: string) => shown.push(id),
}))
mock.module('../ui/tooltip', () => ({
  Tooltip: ({ trigger, children }: { trigger: ReactElement; children: ReactNode }) =>
    cloneElement(trigger, {}, children),
}))

const { BotStatusPill } = await import('./BotStatusPill')

test('the pill rests, opens the Task while working, and shows the oldest question', async () => {
  const dom = new Window()
  const values = {
    window: dom,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    ResizeObserver: dom.ResizeObserver,
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
  const opened: string[] = []
  const render = (onOpenTask?: (botId: string) => void) =>
    act(() =>
      root.render(
        createElement(BotStatusPill, {
          teamId: 'team',
          botId: 'bot',
          channelId: 'c',
          chat: { current: null },
          onOpenTask,
        }),
      ),
    )
  const button = () => container.querySelector('button') as unknown as HTMLElement | null

  try {
    // A resting Bot keeps no room in the title bar.
    await render()
    assert.equal(container.innerHTML, '')

    reading = {
      work: { kind: 'turn', step: { kind: 'thinking' }, reason: 'chat', kids: [] },
      since: 10_000,
    }
    await render((botId) => opened.push(botId))
    assert.match(container.textContent ?? '', /Thinking…0:50/)
    await act(() => button()?.click())
    assert.deepEqual(opened, ['bot'])
    // A viewer who may not open the Task gets words, not a button.
    await render()
    assert.equal(button(), null)

    reading = {
      work: { kind: 'asking', question: 'Connect Sentry?', id: 'q1', count: 2, kids: [] },
      since: undefined,
    }
    await render()
    assert.equal(container.textContent, 'Needs your input (2): Connect Sentry?')
    await act(() => button()?.click())
    assert.deepEqual(shown, ['q1'])
  } finally {
    await act(() => root.unmount())
    for (const [key, descriptor] of originals)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
  }
})
