import { beforeEach, expect, test } from 'bun:test'

import { canReply, conversationAccess, readsConversation } from '@/lib/agent/db/access'

import { localRuntimeId } from '@/lib/agent/devices/local-runtime/address'
import { createLocalTunnelBus } from '@/lib/agent/devices/local-runtime/bus'
import { createMemoryPresenceStore } from '@/lib/agent/devices/local-runtime/presence'
import { holderChannel, streamChannel } from '@/lib/agent/devices/local-runtime/protocol'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useConversationComputer } from '@/lib/test/doubles/conversation-computer'
import { useRuntimeCatalog } from '@/lib/test/doubles/runtime-catalog'

import { openRuntimeDesktop, runtimeDesktopEvents, runtimeDesktopTarget } from './runtime-desktop'

import type { HolderMessage, LocalRuntimeStatus } from '@/lib/agent/devices/local-runtime/protocol'
import type { WSContext, WSEvents } from 'hono/ws'

// Run with: cd apps/backend && bun test src/lib/claude-code-preview/runtime-desktop-invitee.test.ts

// A teammate who may reply in a conversation watches its desktops live; they take one over
// only while an open `computer` card names it. Nobody else, and no other session's display.

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
// The teammate is invited to `chat` only; using the Box lets them reply in both.
const conversations: Record<string, Record<string, unknown>> = {}
// Who may use the Box. Whether that lets them reply is the real rule (conversationAccess).
let boxUsers: Set<string>

const replies = (found: Record<string, unknown>, viewer: string) =>
  canReply(conversationAccess(found as never, viewer, boxUsers.has(viewer)))

// As the database reads it: shared with them, or one they may reply in.
useAgentDb({
  getReadableConversation: (sessionId: string, viewer: string) => {
    const found = conversations[sessionId]

    return found && (readsConversation(found as never, viewer) || replies(found, viewer))
      ? found
      : null
  },
})
useConversationComputer({
  canReplyIn: (async (found: Record<string, unknown>, viewer: string) =>
    replies(found, viewer)) as never,
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
  conversations.other = conversation(
    'other',
    [card({ desktop: { deviceId: 'box', display: 4 } })],
    {
      participantIds: [],
    },
  )
  boxUsers = new Set(['mate'])
  await presence.claim('owner', 'box', 'conn')
  await presence.put('owner', 'box', { conn: 'conn', status, seenAt: Date.now() })
})

test('a teammate who may reply takes over the display an open computer card names', async () => {
  expect(await reach('mate', 'chat', '2')).toEqual({
    userId: 'owner',
    deviceId: 'box',
    teamId: 'team',
    sessionId: 'chat',
    display: 2,
    viewer: 'mate',
    invited: 'control',
  })
  expect('invited' in (await reach('owner', 'chat', '2'))).toBe(false)
})

test('with no open computer card for the display, a teammate who may reply only watches', async () => {
  // Answered (gone), another kind of question, or a card with no desktop.
  for (const requests of [[], [card({ category: 'approval' })], [card({ desktop: undefined })]]) {
    conversations.chat = conversation('chat', requests)
    expect((await reach('mate', 'chat', '2')).invited).toBe('view')
  }
  // The card names another display of the conversation, or the same number on another computer.
  await presence.put('owner', 'box', {
    conn: 'conn',
    status: {
      ...status,
      desktops: [...(status.desktops ?? []), { display: 3, sessionId: 'chat' }],
    },
    seenAt: Date.now(),
  })
  conversations.chat = conversation('chat', [card()])
  expect((await reach('mate', 'chat', '3')).invited).toBe('view')
  conversations.chat = conversation('chat', [card({ desktop: { deviceId: 'mac', display: 2 } })])
  expect((await reach('mate', 'chat', '2')).invited).toBe('view')
})

test('reading the conversation without replying lets nobody watch', async () => {
  // Invited, but without use of the Box the conversation runs on: they only read.
  boxUsers = new Set()
  await expect(reach('mate', 'chat', '2')).rejects.toThrow('not found')
  // Shared to the team to read, not invited, no use of the Box.
  conversations.chat = conversation('chat', [card()], { generalAccess: 'view', participantIds: [] })
  await expect(reach('mate', 'chat', '2')).rejects.toThrow('not found')
})

test('an archived conversation, or one of another team, lets nobody watch', async () => {
  conversations.chat = conversation('chat', [card()], { archivedAt: new Date() })
  await expect(reach('mate', 'chat', '2')).rejects.toThrow('not found')
  conversations.chat = conversation('chat', [card()], { teamId: 'elsewhere' })
  await expect(reach('mate', 'chat', '2')).rejects.toThrow('not found')
})

test("on a shared Box, a teammate reaches a session's display only through that session", async () => {
  // The other session's display through this conversation: the Box reports it as not this one's.
  await expect(reach('mate', 'chat', '4')).rejects.toThrow('not found')
  // A card naming the other session's display still does not make it this conversation's.
  conversations.chat = conversation('chat', [card({ desktop: { deviceId: 'box', display: 4 } })])
  await expect(reach('mate', 'chat', '4')).rejects.toThrow('not found')
  // The other conversation itself: using the Box, they reply there too, so through it they do.
  expect((await reach('mate', 'other', '4')).invited).toBe('control')
  boxUsers = new Set()
  await expect(reach('mate', 'other', '4')).rejects.toThrow('not found')
  // A display nobody holds.
  await expect(reach('mate', 'chat', '9')).rejects.toThrow('not found')
  // The owner still reaches both, each through its own conversation.
  expect((await reach('owner', 'other', '4')).sessionId).toBe('other')
})

test('a teammate cannot open a display; only the owner does', async () => {
  const open = async () => 2

  await expect(openRuntimeDesktop('team', 'mate', 'chat', { presence, open })).rejects.toThrow(
    'not found',
  )
  expect(await openRuntimeDesktop('team', 'owner', 'chat', { presence, open })).toEqual({
    display: 2,
  })
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 30))

/**
 * A teammate's stream whose rechecks answer `now()` (without it, the route's own check),
 * recording the control frames that reach the Box.
 */
const watch = async (user: string, now?: () => Promise<'view' | 'control' | undefined>) => {
  const bus = createLocalTunnelBus()
  const toHost: string[] = []
  const state = { checks: 0, closed: undefined as unknown[] | undefined, toHost }
  const events = runtimeDesktopEvents(await reach(user, 'chat', '2'), {
    bus,
    presence,
    recheckMs: 5,
    ...(now && {
      invitedNow: () => {
        state.checks++

        return now()
      },
    }),
  }) as Required<WSEvents>
  const ws = {
    send: () => {},
    close: (...args: unknown[]) => {
      // The first close is the one the client sees.
      state.closed ??= args
    },
  } as unknown as WSContext

  await bus.subscribe(holderChannel('owner', 'box'), (raw) => {
    const message = JSON.parse(raw) as HolderMessage

    if (message.t === 'open')
      void bus.publish(streamChannel(message.s), JSON.stringify({ t: 'opened', s: message.s }))
    if (message.t === 'data' && message.d.startsWith('{"t":"control"')) toHost.push(message.d)
  })
  events.onOpen(new Event('open'), ws)
  await settle()
  const send = (data: string) => events.onMessage(new MessageEvent('message', { data }), ws)

  return { state, send, end: () => events.onClose(new CloseEvent('close'), ws) }
}
const human = '{"t":"control","owner":"human"}'
const agent = '{"t":"control","owner":"agent"}'

test('once the card is answered, the Box goes back to the agent and the teammate keeps watching', async () => {
  let now: 'view' | 'control' = 'control'
  const { state, send, end } = await watch('mate', async () => now)

  send(human)
  await settle()
  expect(state.toHost).toEqual([human])
  now = 'view'
  await settle()
  // Handed back by the server, the stream still open, and taking over again is refused.
  expect(state.toHost).toEqual([human, agent])
  expect(state.closed).toBeUndefined()
  send(human)
  await settle()
  expect(state.toHost).toEqual([human, agent, agent])
  end()
})

test("no longer able to reply, the teammate's stream ends; the owner's never rechecks", async () => {
  let now: 'view' | undefined = 'view'
  const mate = await watch('mate', async () => now)

  expect(mate.state.closed).toBeUndefined()
  now = undefined
  await settle()
  expect(mate.state.closed).toEqual([1008, 'The invitation ended'])
  mate.end()
  const owner = await watch('owner', async () => undefined)

  await settle()
  expect(owner.state).toMatchObject({ checks: 0, closed: undefined })
  owner.end()
})

test('the route rechecks the conversation itself: answered, they watch; unable to reply, it ends', async () => {
  const { state, send, end } = await watch('mate')

  send(human)
  await settle()
  conversations.chat = conversation('chat', [])
  await settle()
  expect(state.toHost).toEqual([human, agent])
  expect(state.closed).toBeUndefined()
  boxUsers = new Set()
  await settle()
  expect(state.closed).toEqual([1008, 'The invitation ended'])
  end()
})

test('one recheck at a time, and one that fails ends the stream', async () => {
  let fail: (error: Error) => void = () => {}
  const { state, end } = await watch(
    'mate',
    () =>
      new Promise((_resolve, reject) => {
        fail = reject
      }),
  )

  // Many intervals pass while the first check is still out.
  await settle()
  expect(state.checks).toBe(1)
  expect(state.closed).toBeUndefined()
  fail(new Error('the database is down'))
  await settle()
  expect(state.closed).toEqual([1008, 'The invitation ended'])
  end()
})
