import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act } from 'react'

import type { AgentPersistedMessage } from '../../api'

const dom = new Window()
const browser: Record<string, unknown> = {
  window: dom,
  navigator: dom.navigator,
  IS_REACT_ACT_ENVIRONMENT: true,
}

for (const key of Object.getOwnPropertyNames(dom))
  if (!(key in globalThis)) browser[key] = Reflect.get(dom, key)
for (const [key, value] of Object.entries(browser))
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })

mock.module('../agent/AgentAvatar', () => ({ AgentAvatar: () => null }))

const { ChannelMessages } = await import('./ChannelMessages')
const { openChannelAtPost } = await import('./postJump')
const { createRoot } = await import('react-dom/client')

const posts = Array.from(
  { length: 80 },
  (_, i) =>
    ({
      id: `m${String(i)}`,
      role: 'user',
      parts: [{ type: 'text', text: `Post ${String(i)}` }],
      createdAt: new Date(Date.UTC(2026, 10, 20, 0, i)).toISOString(),
      metadata: {
        version: 1,
        sender: { type: 'user', id: 'u1', displayName: 'Mei' },
        source: 'nuphos',
        sentAt: new Date(Date.UTC(2026, 10, 20, 0, i)).toISOString(),
      },
    }) as unknown as AgentPersistedMessage,
)

function open(channelId: string, messages = posts) {
  const host = document.createElement('div')

  document.body.appendChild(host)
  const root = createRoot(host)
  const render = (id: string, shown: AgentPersistedMessage[]) =>
    act(() =>
      root.render(
        <ChannelMessages
          messages={shown}
          events={[]}
          agents={[]}
          viewerId="u1"
          teamId="t"
          onOpenSession={() => {}}
          channelId={id}
        />,
      ),
    )

  render(channelId, messages)

  return {
    render,
    drawn: () => host.querySelectorAll('[data-post-id]').length,
    earlier: () => host.querySelector<HTMLButtonElement>('[data-earlier-messages] button'),
    close: () => {
      act(() => root.unmount())
      host.remove()
    },
  }
}

test('a long chat opens with its latest posts drawn, and the rest on request', () => {
  const chat = open('c1')

  assert.equal(chat.drawn(), 30)
  act(() => chat.earlier()?.click())
  assert.equal(chat.drawn(), 80)
  assert.equal(chat.earlier(), null)
  chat.close()
})

test('a link to an earlier post opens the chat with it drawn', () => {
  openChannelAtPost('c2', 'm3')
  const chat = open('c2')

  assert.equal(chat.drawn(), 80)
  chat.close()
})

test('posts that arrive after the chat opens are drawn from the latest', () => {
  const chat = open('c3', [])

  chat.render('c3', posts)
  assert.equal(chat.drawn(), 30)
  chat.close()
})

test('another chat in the same place opens with its latest drawn', () => {
  const chat = open('c4')

  act(() => chat.earlier()?.click())
  assert.equal(chat.drawn(), 80)
  chat.render('c5', posts)
  assert.equal(chat.drawn(), 30)
  chat.close()
})
