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

const { renderBotMentionLink } = await import('../agent/panel/messageInlineLinks')

const mentionPost = (text: string) =>
  ({
    ...botPost,
    parts: [{ type: 'text', text }],
    metadata: {
      version: 1,
      sender: { type: 'user', id: 'u-2', displayName: 'Mei' },
      source: 'nuphos',
      sentAt: '2026-11-17T09:00:00Z',
    },
  }) as unknown as AgentPersistedMessage

const renderPost = (owned: boolean) =>
  renderToStaticMarkup(
    <ChannelMessage
      message={mentionPost('@書記 please summarize')}
      at={0}
      first
      fresh={false}
      ownAgent={false}
      viewerId="viewer"
      teamId="t"
      links={{
        channelId: 'c',
        bots: [{ id: 'bot-1', displayName: '書記' }],
        renderLink: (href, children) =>
          renderBotMentionLink(href, children, () => (owned ? () => {} : undefined)),
      }}
      onOpenSession={() => {}}
    />,
  )

test('a Bot the chat has joined shows as a mention chip, which opens only for its owner', () => {
  const theirs = renderPost(false)
  const mine = renderPost(true)

  assert.match(theirs, /<span[^>]*data-mention-bot-id="bot-1"[^>]*>@書記<\/span>/)
  assert.match(mine, /<button[^>]*data-mention-bot-id="bot-1"[^>]*>@書記<\/button>/)
})
