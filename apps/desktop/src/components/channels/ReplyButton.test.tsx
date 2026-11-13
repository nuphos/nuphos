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
