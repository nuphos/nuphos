import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { BotChatQuestion } from './BotChatQuestions'
import type { ComponentProps } from 'react'

const integration = (id: string) => ({
  id,
  askedAt: '2026-11-28T00:00:00Z',
  category: 'integration',
  question: 'Connect Microsoft Azure',
  providers: ['azure'],
})
// The Bot asks once, and a Task under it asks once.
const requests = [
  { sessionId: 'bot', title: 'Bot', canManage: true, inputRequest: integration('q1') },
  { sessionId: 'task', title: 'Task', canManage: true, inputRequest: integration('q2') },
]
// Each conversation's picker, named for the conversation it selects in.
const pickers = (id: string | undefined) =>
  id ? { options: {}, value: {}, unset: false, onChange: noop, for: id } : undefined
const cards: ComponentProps<typeof BotChatQuestion>[] = []

function noop() {
  // Nothing is selected or opened in this test.
}

/** Which conversation the latest card of `sessionId`'s question selects in. */
function picked(sessionId: string) {
  const card = cards.findLast((c) => c.request.sessionId === sessionId)

  return (card?.credentials as { for?: string } | undefined)?.for
}

mock.module('../agent/summary/useSessionInputRequests', () => ({
  useSessionInputRequests: () => ({ requests, failed: false, loaded: true }),
}))
mock.module('./useBotCredentials', () => ({
  useBotCredentials: (_teamId: string, id: string | undefined) => pickers(id),
}))
mock.module('./BotChatQuestions', () => ({
  BotChatQuestion: (props: ComponentProps<typeof BotChatQuestion>) => {
    cards.push(props)

    return null
  },
}))

test("a Task's Connect card in its Bot's chat selects in the Task, which changes the Bot's", async () => {
  const dom = new Window()

  for (const [key, value] of Object.entries({
    window: dom,
    navigator: dom.navigator,
    document: dom.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  }))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  const { useBotChatQuestions } = await import('./useBotChatQuestions')
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(dom.document.createElement('div') as unknown as HTMLElement)
  const Chat = () => {
    const { rows } = useBotChatQuestions('team', 'bot', true, noop, false)

    return createElement('div', null, ...rows.map((row) => row.node))
  }

  await act(async () => root.render(createElement(Chat)))
  assert.equal(picked('bot'), 'bot')
  assert.equal(picked('task'), 'task')
  await act(async () => root.unmount())
})
