import { beforeEach, expect, jest, test } from 'bun:test'

import { canReply, conversationAccess } from '@/lib/agent/db/access'

import { localRuntimeId } from '@/lib/agent/devices/local-runtime/address'
import { createLocalTunnelBus } from '@/lib/agent/devices/local-runtime/bus'
import { createMemoryPresenceStore } from '@/lib/agent/devices/local-runtime/presence'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useConversationComputer } from '@/lib/test/doubles/conversation-computer'
import { useRuntimeCatalog } from '@/lib/test/doubles/runtime-catalog'

import {
  INVITE_RECHECK_MS,
  openRuntimeDesktop,
  runtimeDesktopEvents,
  runtimeDesktopTarget,
} from './runtime-desktop'

import type { LocalRuntimeStatus } from '@/lib/agent/devices/local-runtime/protocol'
import type { WSContext, WSEvents } from 'hono/ws'

// Run with: cd apps/backend && bun test src/lib/claude-code-preview/runtime-desktop-invitee.test.ts

// A teammate reaches a conversation's desktop only through its open `computer` card: the
// display that card names, on that Box, while it is open, and only if they may reply.

const runtimeId = localRuntimeId({ userId: 'owner', deviceId: 'box', provider: 'claude-code' })
const card = (overrides: Record<string, unknown> = {}) => ({
  id: 'nuphos-1',
  category: 'computer',
  question: 'Sign in',
  desktop: { deviceId: 'box', display: 2, title: 'Box · :2' },
  askedAt: new Date(),
  status: 'open',
  ...overrides,
})
// Two conversations of the same owner on one shared Box: `chat` holds :2, `other` holds :4.
const conversations: Record<string, Record<string, unknown>> = {}
// Who may use the Box. Whether that lets them reply is the real rule (conversationAccess).
let boxUsers: Set<string>

useAgentDb({ getReadableConversation: (sessionId: string) => conversations[sessionId] ?? null })
useConversationComputer({
  canReplyIn: (async (conversation: Parameters<typeof conversationAccess>[0], viewer: string) =>
    canReply(conversationAccess(conversation, viewer, boxUsers.has(viewer)))) as never,
})
useRuntimeCatalog({
  // The Box's runtime admits only its owner, as a local runtime does.
  requireRuntimeInstance: (async (_team: string, _runtime: string, user?: string) => {
    if (user !== 'owner') throw new Error('runtime not found')

    return { id: runtimeId, label: 'Box', status: 'active', kind: 'local', provider: 'claude-code' }
  }) as never,
})

const presence = createMemoryPresenceStore()
const status = {
  agents: {},
  desktops: [
    { display: 2, sessionId: 'chat' },
    { display: 4, sessionId: 'other' },
  ],
  desktopOpen: true,
} as unknown as LocalRuntimeStatus
const reach = (user: string, sessionId: string, display: string) =>
  runtimeDesktopTarget('team', user, sessionId, display, presence)
const conversation = (
  sessionId: string,
  inputRequests: unknown[] = [],
  more: Record<string, unknown> = {},
) => ({
  sessionId,
  userId: 'owner',
  teamId: 'team',
  runtimeId,
  generalAccess: 'none',
  participantIds: ['mate'],
  inputRequests,
  ...more,
})

beforeEach(async () => {
  conversations.chat = conversation('chat', [card()])
  conversations.other = conversation('other')
  boxUsers = new Set(['mate'])
  await presence.claim('owner', 'box', 'conn')
  await presence.put('owner', 'box', { conn: 'conn', status, seenAt: Date.now() })
})

test('a teammate who may reply reaches the display the open computer card hands over', async () => {
  expect(await reach('mate', 'chat', '2')).toEqual({
    userId: 'owner',
    deviceId: 'box',
    teamId: 'team',
    sessionId: 'chat',
    display: 2,
    viewer: 'mate',
    invited: true,
  })
  expect('invited' in (await reach('owner', 'chat', '2'))).toBe(false)
})

test('reading the conversation without replying is no invitation', async () => {
  // Invited, but without use of the Box the conversation runs on: they only read.
  boxUsers = new Set()
  await expect(reach('mate', 'chat', '2')).rejects.toThrow('not found')
  // Shared to the team to read, not invited, no use of the Box.
  conversations.chat = conversation('chat', [card()], { generalAccess: 'view', participantIds: [] })
  await expect(reach('mate', 'chat', '2')).rejects.toThrow('not found')
})

test('an archived conversation, or one of another team, invites nobody', async () => {
  conversations.chat = conversation('chat', [card()], { archivedAt: new Date() })
  await expect(reach('mate', 'chat', '2')).rejects.toThrow('not found')
  conversations.chat = conversation('chat', [card()], { teamId: 'elsewhere' })
  await expect(reach('mate', 'chat', '2')).rejects.toThrow('not found')
})

test('only a computer card naming a desktop invites; an answered one is gone and invites nobody', async () => {
  for (const request of [card({ category: 'approval' }), card({ desktop: undefined })]) {
    conversations.chat = conversation('chat', [request])
    await expect(reach('mate', 'chat', '2')).rejects.toThrow('not found')
  }
  conversations.chat = conversation('chat')
  await expect(reach('mate', 'chat', '2')).rejects.toThrow('not found')
})

test('the card invites to its own display on its own Box only', async () => {
  // Another display the conversation holds, or the card's display number on another computer.
  conversations.chat = conversation('chat', [card()])
  await presence.put('owner', 'box', {
    conn: 'conn',
    status: {
      ...status,
      desktops: [...(status.desktops ?? []), { display: 3, sessionId: 'chat' }],
    },
    seenAt: Date.now(),
  })
  await expect(reach('mate', 'chat', '3')).rejects.toThrow('not found')
  expect((await reach('owner', 'chat', '3')).display).toBe(3)
  conversations.chat = conversation('chat', [
    card({ desktop: { deviceId: 'mac', display: 2, title: 'Mac' } }),
  ])
  await expect(reach('mate', 'chat', '2')).rejects.toThrow('not found')
})

test("on a shared Box, an invitation to one conversation's display reaches no other session's", async () => {
  // The other session's display through the invited conversation: the Box reports it as not this one's.
  await expect(reach('mate', 'chat', '4')).rejects.toThrow('not found')
  // A card naming the other session's display still does not make it this conversation's.
  conversations.chat = conversation('chat', [
    card({ desktop: { deviceId: 'box', display: 4, title: 'Box · :4' } }),
  ])
  await expect(reach('mate', 'chat', '4')).rejects.toThrow('not found')
  // The other conversation itself, which the teammate may reply in but has no open card.
  await expect(reach('mate', 'other', '4')).rejects.toThrow('not found')
  // The owner still reaches both, each through its own conversation.
  expect((await reach('owner', 'other', '4')).sessionId).toBe('other')
})

test('an invited teammate cannot open a display; only the owner does', async () => {
  const open = async () => 2

  await expect(openRuntimeDesktop('team', 'mate', 'chat', { presence, open })).rejects.toThrow(
    'not found',
  )
  expect(await openRuntimeDesktop('team', 'owner', 'chat', { presence, open })).toEqual({
    display: 2,
  })
})

test("a teammate's stream ends once the card no longer lets them in; the owner's never rechecks", async () => {
  jest.useFakeTimers()
  try {
    const run = async (user: string) => {
      let checks = 0
      let closed: unknown[] | undefined
      let invited = true
      const events = runtimeDesktopEvents(await reach(user, 'chat', '2'), {
        bus: createLocalTunnelBus(),
        presence,
        stillInvited: async () => {
          checks++

          return invited
        },
      }) as Required<WSEvents>
      const ws = {
        send: () => {},
        close: (...args: unknown[]) => {
          // The first close is the one the client sees.
          closed ??= args
        },
      }

      events.onOpen(new Event('open'), ws as unknown as WSContext)
      jest.advanceTimersByTime(INVITE_RECHECK_MS)
      await Promise.resolve()
      expect(closed).toBeUndefined()
      // Answered, withdrawn or archived: the next check closes it.
      invited = false
      jest.advanceTimersByTime(INVITE_RECHECK_MS)
      await Promise.resolve()
      await Promise.resolve()
      const result = { checks, closed }

      events.onClose(new CloseEvent('close'), ws as unknown as WSContext)

      return result
    }

    expect(await run('mate')).toEqual({ checks: 2, closed: [1008, 'The invitation ended'] })
    expect(await run('owner')).toEqual({ checks: 0, closed: undefined })
  } finally {
    jest.useRealTimers()
  }
})
