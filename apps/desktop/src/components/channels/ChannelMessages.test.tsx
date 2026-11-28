import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act } from 'react'

import type { AgentMessageReply, AgentPersistedMessage } from '../../api'

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

function open(channelId: string, messages = posts, onReply?: (reply: AgentMessageReply) => void) {
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
          onReply={onReply}
          channelId={id}
        />,
      ),
    )

  render(channelId, messages)

  return {
    render,
    host,
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

// #5107: Desktop has no native menu, so a post's own menu copies its text or the selection in it.
test('right-clicking a post copies the selection in it or the whole post, beside Reply', async () => {
  const copied: string[] = []
  const replies: AgentMessageReply[] = []

  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: (text: string) => Promise.resolve(void copied.push(text)) },
  })
  const [first] = posts
  const teammate = {
    ...first,
    id: 'teammate-post',
    parts: [{ type: 'text', text: 'Run `bun test`, then check the **log**.' }],
    metadata: {
      ...(first?.metadata as object),
      sender: { type: 'user', id: 'u2', displayName: 'Ana' },
    },
  } as AgentPersistedMessage
  const chat = open('c6', [teammate], (reply) => replies.push(reply))
  const post = chat.host.querySelector('[data-post-id="teammate-post"]')
  const code = post?.querySelector('code')
  const menuItems = () => [...document.querySelectorAll('[role="menuitem"]')]
  const labels = () => menuItems().map((item) => item.textContent)
  const rightClick = () =>
    act(() => {
      post?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 5 }))
    })
  const choose = async (label: string) => {
    const item = menuItems().find((element) => element.textContent === label)

    assert.ok(item instanceof HTMLElement, label)
    await act(async () => {
      item.click()
      await Promise.resolve()
    })
  }

  assert.ok(code)
  // Nothing selected: the whole post, then Reply.
  rightClick()
  assert.deepEqual(labels(), ['Copy message', 'Reply'])
  await choose('Copy message')
  assert.deepEqual(copied, ['Run `bun test`, then check the **log**.'])

  // A selection in the post: that text first.
  const range = document.createRange()
  const selection = window.getSelection()

  range.selectNodeContents(code)
  selection?.removeAllRanges()
  selection?.addRange(range)
  rightClick()
  assert.deepEqual(labels(), ['Copy selected text', 'Copy message', 'Reply'])
  await choose('Copy selected text')
  assert.equal(copied.at(-1), 'bun test')

  rightClick()
  await choose('Reply')
  assert.equal(replies.length, 1)

  // A selection outside the post is not this post's to copy.
  const elsewhere = document.createElement('p')

  elsewhere.textContent = 'Somewhere else'
  document.body.appendChild(elsewhere)
  range.selectNodeContents(elsewhere)
  selection?.removeAllRanges()
  selection?.addRange(range)
  rightClick()
  assert.deepEqual(labels(), ['Copy message', 'Reply'])
  selection?.removeAllRanges()
  elsewhere.remove()
  chat.close()
})

test('a chat the viewer cannot reply in still lets them copy a post', () => {
  const chat = open('c7', posts.slice(0, 1))
  const post = chat.host.querySelector('[data-post-id]')

  act(() => {
    post?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 5 }))
  })
  assert.deepEqual(
    [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent),
    ['Copy message'],
  )
  chat.close()
})
