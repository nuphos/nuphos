import { describe, expect, test } from 'bun:test'

import { createLocalBrowserHandler } from './local-browser'

import type { DeviceToolDeps } from './device-tool'
import type { PreviewToolContext } from '../preview-tool-context'

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
    expect(audits).toEqual(['[browser] eval tab=7 document.title'])
  })

  test('rejects an incomplete call before touching the device', async () => {
    const fake = device(null)
    const handler = createLocalBrowserHandler(ctx, deps({ connect: fake.connect }))

    expect((await handler({ action: 'eval', script: '1' })).isError).toBe(true)
    expect((await handler({ action: 'open' })).isError).toBe(true)
    expect((await handler({ action: 'click' })).isError).toBe(true)
    expect(fake.opened).toHaveLength(0)
  })

  test("only runs in the user's own conversations", async () => {
    const fake = device(null)
    const result = await createLocalBrowserHandler(
      { ...ctx, conversationOwnerUserId: 'someone-else' },
      deps({ connect: fake.connect }),
    )({ action: 'tabs' })

    expect(result.isError).toBe(true)
    expect(fake.opened).toHaveLength(0)
  })
})
