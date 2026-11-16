import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'

import type { AgentConversation } from '../../api'
import type { ReactElement } from 'react'

const calls: string[] = []

mock.module('../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'me' }) }))
mock.module('../agent/channelPeople', () => ({
  leaveSession: (sessionId: string, teamId: string, viewerId: string) => {
    calls.push(`leave ${sessionId} ${teamId} ${viewerId}`)

    return Promise.resolve()
  },
}))

const { chatSidebarItem } = await import('./chat-item')
const { SidebarItemContextMenu } = await import('./item-context-menu')

type MenuItem = { key: string; label: string; onSelect: () => void }

const conversation: AgentConversation = {
  sessionId: 'chat-a',
  title: 'Launch',
  firstMessage: '',
  messageCount: 0,
  createdAt: '2026-11-16T00:00:00Z',
  lastActiveAt: '2026-11-16T00:00:00Z',
}
const ignore = () => {
  /* not under test */
}

function menuFor(row: Partial<AgentConversation>): MenuItem[] {
  const item = chatSidebarItem({
    conversation: { ...conversation, ...row },
    teamId: 'team-a',
    active: false,
    runtimeState: undefined,
    unread: false,
  })
  const element = SidebarItemContextMenu({
    menu: { x: 0, y: 0, item },
    teamId: 'team-a',
    onClose: ignore,
    canFavorite: () => false,
    favoriteMatch: ignore,
    toggleFavorite: ignore,
    renameChat: ignore,
    archiveChat: async (sessionId) => {
      calls.push(`archive ${sessionId}`)
    },
    confirmArchiveBot: ignore,
    unlinkChat: () => Promise.resolve(),
  }) as ReactElement<{ items: MenuItem[] }>

  return element.props.items
}
const labels = (row: Partial<AgentConversation>) => menuFor(row).map((item) => item.label)

test('a member of a group chat leaves it rather than archiving it', () => {
  const items = menuFor({ kind: 'channel', isOwner: false })

  assert.ok(items.some((item) => item.label === 'Leave chat'))
  assert.ok(!items.some((item) => item.label === 'Archive chat'))
  calls.length = 0
  items.find((item) => item.key === 'leave')?.onSelect()
  assert.deepEqual(calls, ['leave chat-a team-a me'])
})

test("a group chat's owner, a Task and a Bot keep Archive", () => {
  assert.ok(labels({ kind: 'channel', isOwner: true }).includes('Archive chat'))
  assert.ok(labels({ isOwner: true }).includes('Archive Task'))
  assert.ok(labels({ avatar: '05-rembrandt', isOwner: true }).includes('Archive Bot'))
  assert.ok(!labels({ kind: 'channel', isOwner: true }).includes('Leave chat'))
  assert.ok(!labels({ isOwner: true }).includes('Leave chat'))
})
