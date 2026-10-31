import { beforeEach, expect, test } from 'bun:test'

import { localRuntimeId } from '@/lib/agent/devices/local-runtime/address'
import { createLocalTunnelBus } from '@/lib/agent/devices/local-runtime/bus'
import { createMemoryPresenceStore } from '@/lib/agent/devices/local-runtime/presence'
import { holderChannel, streamChannel } from '@/lib/agent/devices/local-runtime/protocol'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useRuntimeCatalog } from '@/lib/test/doubles/runtime-catalog'

import {
  openRuntimeDesktop,
  runtimeDesktopEvents,
  runtimeDesktopSessionId,
  runtimeDesktopTarget,
} from './runtime-desktop'

import type { HolderMessage, LocalRuntimeStatus } from '@/lib/agent/devices/local-runtime/protocol'
import type { WSContext, WSEvents } from 'hono/ws'

// Run with: cd apps/backend && bun test src/lib/claude-code-preview/runtime-desktop.test.ts

const runtimeId = localRuntimeId({ userId: 'owner', deviceId: 'box', provider: 'claude-code' })
let conversation: Record<string, unknown> | null

useAgentDb({ getReadableConversation: () => conversation })
useRuntimeCatalog({
  // `boxmate` reaches the owner's Box through its team; `mate` only through a share.
  requireRuntimeInstance: (async (
    _team: string,
    _runtime: string,
    user?: string,
    options: { shared?: boolean } = {},
  ) => {
    if (user !== 'owner' && user !== 'boxmate' && !(user === 'mate' && options.shared))
      throw new Error('runtime not found')

    return { id: runtimeId, label: 'Box', status: 'active', kind: 'local', provider: 'claude-code' }
  }),
})

const presence = createMemoryPresenceStore()
const bus = createLocalTunnelBus()
const status = {
  agents: {},
  desktops: [{ display: 2, sessionId: 'chat' }],
  desktopOpen: true,
} as unknown as LocalRuntimeStatus

beforeEach(async () => {
  conversation = { userId: 'owner', teamId: 'team', runtimeId }
  await presence.claim('owner', 'box', 'conn')
  await presence.put('owner', 'box', { conn: 'conn', status, seenAt: Date.now() })
})

test('only the owner reaches a display the Box reports as this conversation’s', async () => {
  expect(await runtimeDesktopTarget('team', 'owner', 'chat', '2', presence)).toEqual({
    userId: 'owner',
    deviceId: 'box',
    teamId: 'team',
    sessionId: 'chat',
    display: 2,
    viewer: 'owner',
  })
  for (const [user, display] of [
    ['mate', '2'],
    ['owner', '3'],
    ['owner', 'x'],
  ] as const) {
    conversation = { userId: 'owner', teamId: 'team', runtimeId }
    await expect(runtimeDesktopTarget('team', user, 'chat', display, presence)).rejects.toThrow(
      'not found',
    )
  }
  conversation = { userId: 'owner', teamId: 'team', runtimeId: 'managed-1' }
  await expect(runtimeDesktopTarget('team', 'owner', 'chat', '2', presence)).rejects.toThrow(
    'not found',
  )
})

test('opening by hand asks the Box once, and only for a session holding no desktop', async () => {
  const opened: unknown[] = []
  const open = async (target: unknown, sessionId: string) => {
    opened.push([target, sessionId])

    return 3
  }

  // Already holds :2 — answered from presence, no claim.
  expect(await openRuntimeDesktop('team', 'owner', 'chat', { presence, open })).toEqual({
    display: 2,
  })
  expect(opened).toEqual([])
  await presence.put('owner', 'box', {
    conn: 'conn',
    status: { ...status, desktops: [] },
    seenAt: Date.now(),
  })
  expect(await openRuntimeDesktop('team', 'owner', 'chat', { presence, open })).toEqual({
    display: 3,
  })
  expect(opened).toEqual([
    [{ userId: 'owner', actorId: 'owner', deviceId: 'box', teamId: 'team' }, 'chat'],
  ])
  // A Box on an older bundle has a pool but cannot open one on request.
  await presence.put('owner', 'box', {
    conn: 'conn',
    status: { ...status, desktops: [], desktopOpen: undefined },
    seenAt: Date.now(),
  })
  await expect(openRuntimeDesktop('team', 'owner', 'chat', { presence, open })).rejects.toThrow(
    'not found',
  )
  // Not the owner, or a host without a desktop pool: nothing to open.
  await expect(openRuntimeDesktop('team', 'mate', 'chat', { presence, open })).rejects.toThrow(
    'not found',
  )
  await presence.put('owner', 'box', {
    conn: 'conn',
    status: { agents: {} },
    seenAt: Date.now(),
  })
  await expect(openRuntimeDesktop('team', 'owner', 'chat', { presence, open })).rejects.toThrow(
    'not found',
  )
  expect(opened).toHaveLength(1)
})

test('a computer’s own desktop opens from its runtime, for its owner alone', async () => {
  const lock = 'runtime:local_owner_box'
  const codex = {
    runtimeId: localRuntimeId({ userId: 'owner', deviceId: 'box', provider: 'codex' }),
  }
  const opened: unknown[] = []
  const open = async (target: unknown, sessionId: string) => {
    opened.push([target, sessionId])

    return 3
  }

  expect(runtimeDesktopSessionId({ userId: 'owner', deviceId: 'box' })).toBe(lock)
  // The conversation's :2 is not the computer's: the Box is asked for one under the computer's lock.
  expect(await openRuntimeDesktop('team', 'owner', { runtimeId }, { presence, open })).toEqual({
    display: 3,
  })
  expect(opened).toEqual([
    [{ userId: 'owner', actorId: 'owner', deviceId: 'box', teamId: 'team' }, lock],
  ])
  await expect(runtimeDesktopTarget('team', 'owner', { runtimeId }, '2', presence)).rejects.toThrow(
    'not found',
  )
  await presence.put('owner', 'box', {
    conn: 'conn',
    status: { ...status, desktops: [...(status.desktops ?? []), { display: 3, sessionId: lock }] },
    seenAt: Date.now(),
  })
  // Every agent on the computer shares its one desktop.
  expect(await openRuntimeDesktop('team', 'owner', codex, { presence, open })).toEqual({
    display: 3,
  })
  expect(await runtimeDesktopTarget('team', 'owner', codex, '3', presence)).toEqual({
    userId: 'owner',
    deviceId: 'box',
    teamId: 'team',
    sessionId: lock,
    display: 3,
    viewer: 'owner',
  })
  // Neither a teammate the computer is shared with nor a member of the Box's team.
  for (const user of ['mate', 'boxmate']) {
    await expect(
      openRuntimeDesktop('team', user, { runtimeId }, { presence, open }),
    ).rejects.toThrow('not found')
    await expect(runtimeDesktopTarget('team', user, { runtimeId }, '3', presence)).rejects.toThrow(
      'not found',
    )
  }
  await expect(
    runtimeDesktopTarget('team', 'owner', { runtimeId: 'managed-1' }, '3', presence),
  ).rejects.toThrow('not found')
  expect(opened).toHaveLength(1)
})

const b64 = (bytes: number[] | Buffer) => Buffer.from(bytes).toString('base64')
const handshake = b64(Buffer.concat([Buffer.from('RFB 003.008\n'), Buffer.from([1, 1])]))
const key = b64([4, 1, 0, 0, 0, 0, 0, 65])
const update = b64([3, 0, 0, 0, 0, 0, 5, 0, 3, 20])

test('frames cross the tunnel both ways; input waits until the viewer holds the desktop', async () => {
  const toHost: string[] = []
  const toClient: string[] = []
  let closed: unknown[] | undefined
  const target = await runtimeDesktopTarget('team', 'owner', 'chat', '2', presence)
  const events = runtimeDesktopEvents(target, { bus, presence }) as Required<WSEvents>
  const ws = {
    send: (data: string) => toClient.push(data),
    close: (...args: unknown[]) => {
      closed = args
    },
  } as unknown as WSContext

  // The Box's end of the tunnel: it answers the open and echoes every frame back.
  await bus.subscribe(holderChannel('owner', 'box'), (raw) => {
    const message = JSON.parse(raw) as HolderMessage

    if (message.t === 'open')
      void bus.publish(streamChannel(message.s), JSON.stringify({ t: 'opened', s: message.s }))
    if (message.t === 'data') {
      toHost.push(message.d)
      void bus.publish(
        streamChannel(message.s),
        JSON.stringify({ t: 'data', s: message.s, d: `echo:${message.d}` }),
      )
    }
  })
  events.onOpen(new Event('open'), ws)
  await Bun.sleep(20)
  expect(toHost).toEqual([
    JSON.stringify({ t: 'open', sessionId: 'chat', display: 2, viewer: 'owner' }),
  ])
  events.onMessage(new MessageEvent('message', { data: handshake }), ws)
  events.onMessage(new MessageEvent('message', { data: key }), ws)
  events.onMessage(new MessageEvent('message', { data: update }), ws)
  await Bun.sleep(20)
  // The key press never reached the host; the update request did.
  expect(toHost.slice(1)).toEqual([handshake, update])
  expect(toClient).toEqual([
    `echo:${JSON.stringify({ t: 'open', sessionId: 'chat', display: 2, viewer: 'owner' })}`,
    `echo:${handshake}`,
    `echo:${update}`,
  ])
  events.onMessage(new MessageEvent('message', { data: '{"t":"control","owner":"human"}' }), ws)
  events.onMessage(new MessageEvent('message', { data: key }), ws)
  await Bun.sleep(20)
  expect(toHost.slice(3)).toEqual(['{"t":"control","owner":"human"}', key])
  events.onMessage(new MessageEvent('message', { data: '{"t":"control","owner":"agent"}' }), ws)
  events.onMessage(new MessageEvent('message', { data: key }), ws)
  await Bun.sleep(20)
  expect(toHost).toHaveLength(6)
  events.onMessage(new MessageEvent('message', { data: 'x'.repeat(64 * 1024 + 1) }), ws)
  expect(closed).toEqual([1008, 'Invalid desktop frame'])
})

test('a dock browser tab opens the Desktop’s browserView stream, naming the tab and page size', async () => {
  const opened: { purpose?: string; frame?: string }[] = []
  const target = {
    userId: 'owner',
    deviceId: 'box',
    teamId: 'team',
    sessionId: 'chat',
    display: 0,
    viewer: 'owner',
    tab: { id: 'tab-1', width: 390, height: 700 },
  }

  // Only a Desktop that says it serves browser tabs is asked.
  await presence.put('owner', 'box', {
    conn: 'conn',
    status: { ...status, localBrowserView: true },
    seenAt: Date.now(),
  })
  const events = runtimeDesktopEvents(target, { bus, presence }) as Required<WSEvents>
  const ws = { send: () => {}, close: () => {} } as unknown as WSContext

  await bus.subscribe(holderChannel('owner', 'box'), (raw) => {
    const message = JSON.parse(raw) as HolderMessage & { purpose?: string; d?: string }

    if (message.t === 'open') {
      opened.push({ purpose: message.purpose })
      void bus.publish(streamChannel(message.s), JSON.stringify({ t: 'opened', s: message.s }))
    }
    if (message.t === 'data') opened.push({ frame: message.d })
  })
  events.onOpen(new Event('open'), ws)
  await Bun.sleep(20)
  // Another test's host may answer the open too; each frame is still this one.
  expect(opened[0]).toEqual({ purpose: 'browserView' })
  expect(new Set(opened.slice(1).map((entry) => entry.frame))).toEqual(
    new Set([
      JSON.stringify({ t: 'open', sessionId: 'chat', tab: 'tab-1', width: 390, height: 700 }),
    ]),
  )
  events.onClose(new CloseEvent('close'), ws)
})
