import { describe, expect, test } from 'bun:test'

import { localRuntimeId } from '@/lib/agent/devices/local-runtime/address'
import { runtimePresenceStore } from '@/lib/agent/devices/local-runtime/presence'

import { boxDesktops, sessionDesktops, withSessionDesktops } from './session-desktops'

import type { LocalRuntimeStatus } from '@/lib/agent/devices/local-runtime/protocol'
import type { SessionExecutionState } from './runtime-execution-snapshot'

// Run with: cd apps/backend && bun test src/lib/claude-code-preview/session-desktops.test.ts

const runtimeId = localRuntimeId({ userId: 'u1', deviceId: 'box-1', provider: 'claude-code' })
const status = {
  agents: {},
  desktops: [
    { display: 2, sessionId: 's1' },
    { display: 3, sessionId: 's2' },
  ],
  desktopOpen: true,
} as unknown as LocalRuntimeStatus
const label = async () => 'Box 1'

describe('session desktops', () => {
  test('a conversation sees only its own desktops on its Box, as running tools', async () => {
    const store = runtimePresenceStore()

    await store.claim('u1', 'box-1', 'c1')
    expect(await store.put('u1', 'box-1', { conn: 'c1', status, seenAt: Date.now() })).toBe(true)

    expect(await sessionDesktops({ sessionId: 's1', runtimeId }, label)).toEqual({
      canOpen: true,
      tools: [
        {
          id: 'desktop:2',
          kind: 'desktop',
          title: 'Box 1 · :2',
          status: 'running',
          desktop: { display: 2, deviceId: 'box-1' },
        },
      ],
    })
    const snapshot: SessionExecutionState = { state: 'idle', tools: [{ id: 't1' }] }

    // No desktop yet, but its Box can open one.
    expect(await withSessionDesktops(snapshot, { sessionId: 's3', runtimeId }, label)).toEqual({
      ...snapshot,
      canOpenDesktop: true,
    })
    expect(
      (await withSessionDesktops(snapshot, { sessionId: 's2', runtimeId }, label)).tools?.map(
        (t) => t.id,
      ),
    ).toEqual(['t1', 'desktop:3'])
  })

  test("a Box lists the viewer's own session displays in this team, never another member's", async () => {
    const store = runtimePresenceStore()

    await store.claim('u1', 'box-1', 'c1')
    await store.put('u1', 'box-1', { conn: 'c1', status, seenAt: Date.now() })
    const conversations = async () => [
      { sessionId: 's1', userId: 'viewer', teamId: 't1', title: 'Fix login' },
      { sessionId: 's2', userId: 'someone-else', teamId: 't1', title: 'Theirs' },
    ]

    expect(await boxDesktops('u1', 'box-1', 'viewer', 't1', conversations)).toEqual([
      { display: 2, sessionId: 's1', title: 'Fix login' },
    ])
    expect(await boxDesktops('u1', 'box-1', 'viewer', 'other-team', conversations)).toEqual([])
    expect(await boxDesktops('u1', 'box-2', 'viewer', 't1', conversations)).toEqual([])
  })

  test('a Box on an older bundle lists its desktops but offers no manual open', async () => {
    const store = runtimePresenceStore()

    await store.claim('u1', 'box-1', 'c1')
    await store.put('u1', 'box-1', {
      conn: 'c1',
      status: { ...status, desktopOpen: undefined },
      seenAt: Date.now(),
    })
    const desktops = await sessionDesktops({ sessionId: 's1', runtimeId }, label)

    expect(desktops.canOpen).toBe(false)
    expect(desktops.tools.map((tool) => tool.id)).toEqual(['desktop:2'])
    const snapshot: SessionExecutionState = { state: 'idle' }

    expect(await withSessionDesktops(snapshot, { sessionId: 's3', runtimeId }, label)).toBe(
      snapshot,
    )
  })

  test('a conversation off any local runtime has none', async () => {
    const none = { tools: [], canOpen: false }
    const snapshot = { state: 'idle' as const }

    expect(await sessionDesktops({ sessionId: 's1', runtimeId: 'managed-1' })).toEqual(none)
    expect(await sessionDesktops({ sessionId: 's1' })).toEqual(none)
    expect(await withSessionDesktops(snapshot, { sessionId: 's1' })).toBe(snapshot)
  })
})
