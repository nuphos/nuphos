import assert from 'node:assert/strict'
import { test } from 'node:test'

import { renderToStaticMarkup } from 'react-dom/server'

import { ChannelMessage } from './ChannelPost'
import { ReplyButton } from './ReplyButton'

import type { AgentPersistedMessage } from '../../api'

const post = {
  id: 'm1',
  role: 'user',
  parts: [{ type: 'text', text: 'Ship it on Friday?' }],
  createdAt: '2026-11-13T09:00:00Z',
  metadata: {
    version: 1,
    sender: { type: 'user', id: 'alex', displayName: 'Alex' },
    source: 'nuphos',
    sentAt: '2026-11-13T09:00:00Z',
  },
} as unknown as AgentPersistedMessage

const render = (onReply?: () => void, viewerId = 'viewer') =>
  renderToStaticMarkup(
    <ChannelMessage
      message={post}
      at={0}
      first
      fresh={false}
      ownAgent={false}
      viewerId={viewerId}
      teamId="t"
      links={{ channelId: 'c', renderLink: (_, children) => children }}
      onOpenSession={() => {}}
      onReply={onReply}
    />,
  )

test('the reply button stays hidden until the pointer is over its post, and replies', () => {
  let replied = 0
  const button = ReplyButton({
    onReply: () => {
      replied += 1
    },
  })
  const markup = renderToStaticMarkup(button)

  assert.match(markup, /aria-label="Reply"/)
  assert.match(markup, /opacity-0/)
  assert.match(markup, /group-hover\/post:opacity-100/)
  ;(button.props as { onClick: () => void }).onClick()
  assert.equal(replied, 1)
})

test("a post offers the button beside it, someone else's and your own", () => {
  const theirs = render(() => {})

  assert.match(theirs, /group\/post/)
  assert.match(theirs, /aria-label="Reply"/)
  assert.match(
    render(() => {}, 'alex'),
    /aria-label="Reply"/,
  )
})

test('a viewer who cannot reply gets no button', () => {
  assert.doesNotMatch(render(), /aria-label="Reply"/)
})

test('the reply button is centred on the bubble, not on the name or files above it', () => {
  for (const [viewer, bubble, edge] of [
    ['viewer', 'bg-state-selected', 'left-full'],
    ['alex', 'user-message-bubble', 'right-full'],
  ] as const) {
    const markup = render(() => {}, viewer)
    const button = markup.match(/<button[^>]*aria-label="Reply"[^>]*>/)?.[0] ?? ''

    assert.match(button, /absolute top-1\/2 -translate-y-1\/2/, viewer)
    assert.ok(button.includes(edge), viewer)
    // It rides the bubble's wrapper, after the bubble itself.
    assert.ok(markup.indexOf(bubble) < markup.indexOf('aria-label="Reply"'), viewer)
    assert.match(markup, /<div class="relative max-w-full"><div class="[^"]*/, viewer)
  }
})
