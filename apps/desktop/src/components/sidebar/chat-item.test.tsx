import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createElement, isValidElement } from 'react'

import { ChatIcon } from '../channels/channelParts'

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
  const result = BotPinFace({ item: { key: 'bot-a', label: 'Bot', enabled: true, face }, size: 56 })

  assert.ok(isValidElement<{ size: number; sidebar: boolean }>(result))
  assert.equal(result.props.size, 56)
  assert.equal(result.props.sidebar, false)
})
