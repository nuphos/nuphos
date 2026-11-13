import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createElement, isValidElement } from 'react'

import { ChatIcon } from '../channels/channelParts'

import { botChatRows } from './bot-status'
import { BotPinFace } from './BotPinFace'
import { chatSidebarItem } from './chat-item'

import type { AgentConversation } from '../../api'

const conversation: AgentConversation = {
  sessionId: 'bot-a',
  title: 'Bot',
  firstMessage: '',
  messageCount: 0,
  createdAt: '2026-11-12T00:00:00Z',
  lastActiveAt: '2026-11-12T00:00:00Z',
  avatar: '05-rembrandt',
}
const item = (picked?: string | null) =>
  chatSidebarItem({
    conversation,
    teamId: 'team-a',
    active: false,
    runtimeState: undefined,
    unread: false,
    picked,
  })

test('Bots never receive task Idle classification, but removing their avatar restores Task classification', () => {
  assert.equal(item().bot, true)
  assert.equal(item().taskState, undefined)
  assert.equal(item(null).bot, undefined)
  assert.equal(item(null).taskState, 'idle')
})
test('a pinned face receives its actual rendering size rather than a larger wrapper', () => {
  const face = createElement(ChatIcon, { sidebar: true, title: 'Bot' })
  const result = BotPinFace({
    item: { key: 'bot-a', label: 'Bot', enabled: true, iconNode: face },
    size: 56,
  })

  assert.ok(isValidElement<{ size: number; sidebar: boolean }>(result))
  assert.equal(result.props.size, 56)
  assert.equal(result.props.sidebar, false)
})

test('Bots show actual sub-agents directly, without a duplicate own Task', () => {
  const chat = { ...item(), key: 'chat', channel: true, bot: false }
  const bot = { conversation, runtimeState: undefined }
  const kid = {
    conversation: { ...conversation, sessionId: 'kid', parentSessionId: conversation.sessionId },
    runtimeState: undefined,
  }
  const rows = botChatRows({
    chat,
    bot,
    kids: [kid],
    faces: [],
    teamId: 'team-a',
    unread: false,
    openId: 'kid',
  })

  assert.equal(
    rows[1]?.active,
    true,
    'a Bot task opened directly still highlights its only sidebar row',
  )
  assert.deepEqual(
    rows.map((row) => [row.key, row.parentKey]),
    [
      ['chat', undefined],
      ['agent-session:kid', 'chat'],
    ],
  )
})

test('reading a Bot question clears its dot but keeps the action-needed preview', () => {
  const chat = { ...item(), key: 'chat', channel: true }
  const bot = {
    conversation: {
      ...conversation,
      inputRequests: [
        {
          id: 'q',
          category: 'preference' as const,
          question: 'Which?',
          status: 'open' as const,
          askedAt: '2026-11-12T00:00:00Z',
        },
      ],
    },
    runtimeState: undefined,
  }

  for (const unread of [false, true]) {
    const [row] = botChatRows({
      chat,
      bot,
      kids: [],
      faces: [],
      teamId: 'team-a',
      unread,
      openId: undefined,
    })

    assert.ok(isValidElement<{ dot: string | null }>(row?.trailing))
    assert.equal(row.trailing.props.dot, unread ? 'unread' : null)
    assert.equal(row.dot, unread ? 'unread' : null)
    assert.ok(row?.previewNode)
  }
})
