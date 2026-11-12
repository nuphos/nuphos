import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useIdentity } from '@/lib/test/doubles/identity'
import type { AgentConversation } from '@/lib/agent/db'
import type { TeamMembership } from '@/lib/identity/types'
import { describe, expect, test } from 'bun:test'

import { createLocalBrowserHandler, localBrowserToolModule } from './local-browser'

import type { DeviceToolDeps } from './device-tool'
import type { PreviewToolContext } from '../preview-tool-context'

const conversationAccess = useAgentDb({
  getConversationBySessionId: () =>
    Promise.resolve({
      sessionId: 's1',
      userId: 'owner',
      teamId: 't1',
      participantIds: ['u1'],
    } as AgentConversation),
})

useIdentity({ getTeamMembership: () => Promise.resolve({ role: 'EDITOR' } as TeamMembership) })

type Listener = (event: { data?: unknown }) => void

const ctx: PreviewToolContext = {
  userId: 'u1',
  teamId: 't1',
  sessionId: 's1',
  turnKey: 'turn-1',
  locale: 'en',
}

/** A device that answers every call with `result`, recording the purpose and frames. */
function device(result: unknown) {
  const opened: { purpose: string; sent: Record<string, unknown>[] }[] = []
  const connect: DeviceToolDeps['connect'] = (_ctx, _deviceId, _owner, purpose) => {
    const listeners = new Map<string, Listener[]>()
    const emit = (type: string, data?: unknown) => {
      for (const listener of listeners.get(type) ?? [])
        listener(data === undefined ? {} : { data: JSON.stringify(data) })
    }
    const record = { purpose, sent: [] as Record<string, unknown>[] }

    opened.push(record)

    return {
      addEventListener: (type: string, listener: Listener) => {
        listeners.set(type, [...(listeners.get(type) ?? []), listener])
      },
      send: (data: string) => {
        record.sent.push(JSON.parse(data) as Record<string, unknown>)
        emit('message', { t: 'result', result })
      },
      close: () => {},
      connect: async () => {
        emit('open')
      },
    }
  }

  return { opened, connect }
}

function deps(overrides: Partial<DeviceToolDeps>): DeviceToolDeps {
  return {
    devices: async () => [{ deviceId: 'mac', label: 'MacBook' }],
    isMember: async () => true,
    owner: async () => 'host-owner',
    connect: device(null).connect,
    approve: async () => false,
    publish: async () => {},
    audit: async () => {},
    timeoutMs: 1_000,
    ...overrides,
  }
}

describe('local_browser', () => {
  test('sends the action to the browser stream with the team, and returns the result', async () => {
    const tabs = { content: [{ type: 'text' as const, text: '[{"tab":7}]' }] }
    const fake = device(tabs)
    const audits: string[] = []

    const result = await createLocalBrowserHandler(
      ctx,
      deps({
        connect: fake.connect,
        audit: async (entry) => {
          audits.push(entry.command)
        },
      }),
    )({ action: 'eval', tab: 7, script: 'document.title' })

    expect(result).toEqual(tabs)
    expect(fake.opened).toHaveLength(1)
    expect(fake.opened[0]?.purpose).toBe('browser')
    expect(fake.opened[0]?.sent[0]).toEqual({
      t: 'call',
      session: 's1',
      turn: 'turn-1',
      action: 'eval',
      team: 't1',
      tab: 7,
      script: 'document.title',
    })

    expect(audits).toEqual([
      '[browser] eval tab=7 document.title',
      '[browser] eval tab=7 document.title',
    ])
  })

  test('rejects an incomplete call before touching the device', async () => {
    const fake = device(null)
    const handler = createLocalBrowserHandler(ctx, deps({ connect: fake.connect }))

    expect((await handler({ action: 'eval', script: '1' })).isError).toBe(true)
    expect((await handler({ action: 'open' })).isError).toBe(true)
    expect((await handler({ action: 'click' })).isError).toBe(true)
    expect((await handler({ action: 'record_start' })).isError).toBe(true)
    expect((await handler({ action: 'record_stop' })).isError).toBe(true)
    expect(fake.opened).toHaveLength(0)
  })

  test("opens on the user's own screen when a Nuphos computer is also selected", async () => {
    const targets: string[] = []
    const fake = device(null)
    const connect: DeviceToolDeps['connect'] = (c, deviceId, owner, purpose) => {
      targets.push(deviceId)

      return fake.connect(c, deviceId, owner, purpose)
    }
    const devices = async () => [
      { deviceId: 'box', label: 'Computer 1', box: true },
      { deviceId: 'mac', label: 'MacBook' },
    ]
    const handler = createLocalBrowserHandler(ctx, deps({ devices, connect }))

    await handler({ action: 'open', url: 'https://dash.cloudflare.com/login' })
    // Naming the Box still reaches it.
    await handler({ action: 'tabs', device: 'box' })

    expect(targets).toEqual(['mac', 'box'])
  })

  test('opens the tab in the channel that woke the turn, only when exactly one did', async () => {
    const docks: unknown[] = []

    for (const asked of [['channel-1'], [], ['channel-1', 'channel-2']]) {
      const fake = device(null)

      await createLocalBrowserHandler(
        ctx,
        deps({ connect: fake.connect }),
        async () => asked,
      )({
        action: 'open',
        url: 'https://example.com',
      })
      docks.push(fake.opened[0]?.sent[0]?.dock)
    }

    expect(docks).toEqual(['channel-1', undefined, undefined])
  })

  test('looks up the asking channel only for open', async () => {
    let lookups = 0
    const handler = createLocalBrowserHandler(ctx, deps({}), async () => {
      lookups += 1

      return ['channel-1']
    })

    await handler({ action: 'tabs' })

    expect(lookups).toBe(0)
  })

  test('tells the agent to open a named site and sign-in pages itself', () => {
    const description = String(
      (localBrowserToolModule.definitions[0] as { description?: string }).description,
    )

    expect(description).toContain(
      'A site or app named by the user ("open up TikTok") means its official URL (https://www.tiktok.com)',
    )

    expect(description).toContain(
      'open that login or sign-up page here yourself, sub-agents included',
    )
  })
})

test('an authorized teammate can use the selected conversation browser', async () => {
  const tabs = { content: [{ type: 'text' as const, text: '[]' }] }
  const fake = device(tabs)
  const actors: string[] = []
  const result = await createLocalBrowserHandler(
    { ...ctx, conversationOwnerUserId: 'conversation-owner' },
    deps({
      connect: fake.connect,
      audit: async (entry) => {
        actors.push(entry.actorUserId)
      },
    }),
  )({ action: 'tabs' })

  expect(result).toEqual(tabs)
  expect(actors).toEqual(['u1', 'u1'])
})

test('removing a teammate stops the next browser call in the same turn', async () => {
  let participants = ['u1']

  conversationAccess({
    getConversationBySessionId: () =>
      Promise.resolve({
        sessionId: 's1',
        userId: 'owner',
        teamId: 't1',
        generalAccess: 'none',
        participantIds: participants,
      } as AgentConversation),
  })
  const tabs = { content: [{ type: 'text' as const, text: '[]' }] }
  const fake = device(tabs)
  const handler = createLocalBrowserHandler(
    { ...ctx, conversationOwnerUserId: 'owner' },
    deps({ connect: fake.connect }),
  )

  expect(await handler({ action: 'tabs' })).toEqual(tabs)
  participants = []

  await expect(handler({ action: 'tabs' })).rejects.toMatchObject({
    code: 'conversation_read_only',
  })
  expect(fake.opened).toHaveLength(1)
})
