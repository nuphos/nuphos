import assert from 'node:assert/strict'
import { mock, test } from 'bun:test'

import { renderToStaticMarkup } from 'react-dom/server'

mock.module('../agent/AgentAvatar', () => ({ AgentAvatar: () => null }))

const { ChannelMessage } = await import('./ChannelPost')

import type { AgentPersistedMessage } from '../../api'

const botPost = {
  id: 'm1',
  role: 'user',
  parts: [{ type: 'text', text: 'Minutes are posted.' }],
  createdAt: '2026-11-17T09:00:00Z',
  metadata: {
    version: 1,
    sender: { type: 'agent', id: 'bot-1', displayName: 'Scribe', agentRuntime: 'claude-code' },
    source: 'agent.thread',
    sourceSessionId: 'bot-1',
    sentAt: '2026-11-17T09:00:00Z',
  },
} as unknown as AgentPersistedMessage

test("a Bot's post is headed by its name alone, never an Agent tag", () => {
  const markup = renderToStaticMarkup(
    <ChannelMessage
      message={botPost}
      at={0}
      first
      fresh={false}
      ownAgent
      viewerId="viewer"
      teamId="t"
      links={{ channelId: 'c', renderLink: (_, children) => children }}
      onOpenSession={() => {}}
    />,
  )

  assert.match(markup, />Scribe</)
  assert.doesNotMatch(markup, />Agent</)
})

const answer = (viewerId: string, answeredInInbox: boolean) =>
  renderToStaticMarkup(
    <ChannelMessage
      message={
        {
          id: 'm2',
          role: 'user',
          parts: [{ type: 'text', text: 'us-east' }],
          createdAt: '2026-11-18T09:00:00Z',
          metadata: {
            version: 1,
            sender: { type: 'user', id: 'u1', displayName: 'Mei' },
            source: 'nuphos',
            sentAt: '2026-11-18T09:00:00Z',
            replyTo: { authorName: 'Scribe', text: 'Which regions?' },
            answeredIn: 'inbox',
            requestId: 'q1',
          },
        } as unknown as AgentPersistedMessage
      }
      at={0}
      first
      fresh={false}
      ownAgent={false}
      viewerId={viewerId}
      teamId="t"
      links={{ channelId: 'c', renderLink: (_, children) => children }}
      onOpenSession={() => {}}
      answeredInInbox={answeredInInbox}
    />,
  )

test('a reply quotes its post inside its own bubble, above the words', () => {
  for (const [viewer, bubble, tint] of [
    ['u1', 'user-message-bubble', 'bg-white/15'],
    ['someone-else', 'bg-state-selected', 'bg-black/5'],
  ] as const) {
    const markup = answer(viewer, false)
    const inBubble = markup.slice(markup.indexOf(bubble))

    assert.ok(inBubble.indexOf('Which regions?') >= 0, viewer)
    assert.ok(inBubble.indexOf('Which regions?') < inBubble.indexOf('us-east'), viewer)
    assert.ok(inBubble.includes(tint), viewer)
    assert.ok(inBubble.includes('line-clamp-2'), viewer)
  }
})

test('only the last post of an Inbox answer says where it was answered', () => {
  assert.ok(answer('u1', true).includes('Answered in Inbox'))
  assert.ok(!answer('u1', false).includes('Answered in Inbox'))
})

test("a teammate's bubble is filled like a Bot's, not outlined", () => {
  const render = (message: AgentPersistedMessage) =>
    renderToStaticMarkup(
      <ChannelMessage
        message={message}
        at={0}
        first
        fresh={false}
        ownAgent={false}
        viewerId="viewer"
        teamId="t"
        links={{ channelId: 'c', renderLink: (_, children) => children }}
        onOpenSession={() => {}}
      />,
    )
  const bubbleClass = (markup: string) => markup.match(/class="([^"]*rounded-tl-md[^"]*)"/)?.[1]
  const teammate = {
    ...botPost,
    metadata: {
      ...botPost.metadata,
      sender: { type: 'user', id: 'u2', displayName: 'Mei' },
      source: 'nuphos',
      sourceSessionId: undefined,
    },
  } as unknown as AgentPersistedMessage

  assert.ok(bubbleClass(render(botPost))?.includes('bg-state-selected'))
  assert.equal(bubbleClass(render(teammate)), bubbleClass(render(botPost)))
})

test("a reply's quote spans its bubble's full width without widening it", () => {
  for (const viewer of ['u1', 'someone-else']) {
    const quote =
      answer(viewer, false).match(/<button[^>]*title="Which regions\?"[^>]*>/)?.[0] ?? ''

    assert.ok(quote.includes('w-[calc(100%+0.5rem)]'), viewer)
    assert.ok(quote.includes('[contain:inline-size]'), viewer)
    assert.ok(!quote.includes('max-w-[18rem]'), viewer)
  }
})
