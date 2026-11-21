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

function open(channelId: string) {
  const host = document.createElement('div')

  document.body.appendChild(host)
  const root = createRoot(host)

  act(() =>
    root.render(
      <ChannelMessages
        messages={posts}
        events={[]}
        agents={[]}
        viewerId="u1"
        teamId="t"
        onOpenSession={() => {}}
        channelId={channelId}
      />,
    ),
  )

  return {
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
