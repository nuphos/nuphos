import { beforeEach, describe, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'

import { focusSessionBrowserTab, sessionBrowserTabs } from './session-browser-tabs'

import type { DeviceToolDeps } from './preview-tools/device-tool'

// Run with: cd apps/backend && bun test src/lib/claude-code-preview/session-browser-tabs.test.ts

type Listener = (event: { data?: unknown }) => void

let conversation: Record<string, unknown> | null

useAgentDb({ getReadableConversation: () => conversation })

beforeEach(() => {
  conversation = { userId: 'owner', teamId: 't1', runtimeId: 'rt' }
})

/** A device answering every call with `result`, recording the frames and audits. */
function device(result: unknown) {
  const sent: Record<string, unknown>[] = []
  const audits: string[] = []
  const published: unknown[] = []
  const connect: DeviceToolDeps['connect'] = () => {
    const listeners = new Map<string, Listener[]>()
    const emit = (type: string, data?: unknown) => {
      for (const listener of listeners.get(type) ?? [])
        listener(data === undefined ? {} : { data: JSON.stringify(data) })
    }

    return {
      addEventListener: (type: string, listener: Listener) => {
        listeners.set(type, [...(listeners.get(type) ?? []), listener])
      },
      send: (data: string) => {
        sent.push(JSON.parse(data) as Record<string, unknown>)
        emit('message', { t: 'result', result })
      },
      close: () => {},
      connect: async () => {
        emit('open')
      },
    }
  }
  const deps: DeviceToolDeps = {
    devices: async () => [{ deviceId: 'mac', label: 'MacBook' }],
    isMember: async () => true,
    owner: async () => 'owner',
    connect,
    approve: async () => false,
    publish: async (_ctx, frame) => {
      published.push(frame)
    },
    audit: async (entry) => {
      audits.push(entry.command)
    },
    timeoutMs: 1_000,
  }

  return { sent, audits, published, deps }
}

const tabs = [{ id: 'tab-1', url: 'https://example.com/', title: 'Example' }]

describe('session browser tabs', () => {
  test("lists the conversation's tabs from the owner's device, audited", async () => {
    const fake = device({ content: [{ type: 'text', text: JSON.stringify(tabs) }] })

    expect(await sessionBrowserTabs('t1', 'owner', 's1', fake.deps)).toEqual(tabs)
    expect(fake.sent).toEqual([
      { t: 'call', session: 's1', turn: 's1', action: 'dock', team: 't1' },
    ])
    expect(fake.audits).toEqual(['[browser] phone dock'])
  })

  test('focus sends only the dock tab id', async () => {
    const fake = device({ content: [{ type: 'text', text: '{}' }] })

    await focusSessionBrowserTab('t1', 'owner', 's1', 'tab-1', fake.deps)
    expect(fake.sent[0]).toMatchObject({
      action: 'focus',
      dockTab: 'tab-1',
      team: 't1',
      session: 's1',
    })
    expect(fake.audits).toEqual(['[browser] phone focus tab=tab-1'])
  })

  test("someone else's conversation is not found and reaches no device", async () => {
    conversation = { userId: 'other', teamId: 't1' }
    const fake = device(null)

    await expect(sessionBrowserTabs('t1', 'owner', 's1', fake.deps)).rejects.toMatchObject({
      status: 404,
    })
    expect(fake.sent).toEqual([])
  })

  test("a device's error reaches the caller as its text", async () => {
    const fake = device({ isError: true, content: [{ type: 'text', text: 'Update Nuphos' }] })

    await expect(sessionBrowserTabs('t1', 'owner', 's1', fake.deps)).rejects.toMatchObject({
      status: 409,
      message: 'Update Nuphos',
    })
  })
})
