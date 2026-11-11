import { beforeEach, describe, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'

import {
  browserTabsOf,
  closeSessionDockTab,
  focusSessionBrowserTab,
  openSessionDockTab,
  sessionBrowserViewTarget,
  sessionDock,
} from './session-browser-tabs'

import type { DeviceToolDeps } from './preview-tools/device-tool'
import type { AgentConversation } from '@/lib/agent/db'

// Run with: cd apps/backend && bun test src/lib/claude-code-preview/session-browser-tabs.test.ts

type Listener = (event: { data?: unknown }) => void

let conversation: Record<string, unknown> | null

useAgentDb({
  getReadableConversation: () => conversation,
  getConversationBySessionId: () => Promise.resolve(conversation as AgentConversation | null),
})

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
  test("an older Desktop's list of browser tabs reads as a dock of them, audited", async () => {
    const fake = device({ content: [{ type: 'text', text: JSON.stringify(tabs) }] })
    const dock = await sessionDock('t1', 'owner', 's1', fake.deps)

    expect(dock).toEqual({
      tabs: [
        {
          id: 'tab-1',
          url: 'https://example.com/',
          title: 'Example',
          kind: 'team.browser',
          href: '',
        },
      ],
      activeTabId: null,
      recent: [],
    })
    expect(browserTabsOf(dock)).toEqual(tabs)
    expect(fake.sent).toEqual([
      { t: 'call', session: 's1', turn: 's1', action: 'dock', team: 't1' },
    ])
    expect(fake.audits).toEqual(['[browser] phone dock', '[browser] phone dock'])
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
    expect(fake.audits).toEqual([
      '[browser] phone focus tab=tab-1',
      '[browser] phone focus tab=tab-1',
    ])
  })

  test('the whole dock comes as the Mac mirrors it; only its browser tabs keep the old shape', async () => {
    const dock = {
      tabs: [
        {
          id: 'b1',
          kind: 'team.browser',
          title: 'Example',
          href: '/teams/t1/browser?url=x',
          url: 'https://example.com/',
        },
        { id: 'term', kind: 'team.terminal', title: 'Local terminal', href: '/teams/t1/terminal' },
      ],
      activeTabId: 'term',
      recent: [{ href: '/teams/t1/runtimes', title: 'Runtimes' }],
    }
    const fake = device({ content: [{ type: 'text', text: JSON.stringify(dock) }] })
    const read = await sessionDock('t1', 'owner', 's1', fake.deps)

    expect(read).toEqual(dock)
    expect(browserTabsOf(read)).toEqual([
      { id: 'b1', url: 'https://example.com/', title: 'Example' },
    ])
  })

  test('close and open reach the Mac with only the tab id or the page, audited', async () => {
    const fake = device({ content: [{ type: 'text', text: JSON.stringify({ id: 'new-tab' }) }] })

    await closeSessionDockTab('t1', 'owner', 's1', 'tab-1', fake.deps)
    expect(
      await openSessionDockTab('t1', 'owner', 's1', { href: '/teams/t1/files' }, fake.deps),
    ).toBe('new-tab')
    await openSessionDockTab('t1', 'owner', 's1', { page: 'team.plans' }, fake.deps)
    expect(
      fake.sent.map(({ action, dockTab, href, page }) => ({ action, dockTab, href, page })),
    ).toEqual([
      { action: 'close', dockTab: 'tab-1', href: undefined, page: undefined },
      { action: 'dock_open', dockTab: undefined, href: '/teams/t1/files', page: undefined },
      { action: 'dock_open', dockTab: undefined, href: undefined, page: 'team.plans' },
    ])
    expect(new Set(fake.audits)).toEqual(
      new Set([
        '[browser] phone close tab=tab-1',
        '[browser] phone dock_open /teams/t1/files',
        '[browser] phone dock_open team.plans',
      ]),
    )
  })

  test("another team's page, or a malformed page key, never reaches the device", async () => {
    const fake = device({ content: [{ type: 'text', text: '{}' }] })

    await expect(
      openSessionDockTab('t1', 'owner', 's1', { href: '/teams/t2/files' }, fake.deps),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      openSessionDockTab('t1', 'owner', 's1', { page: 'team.plans/../../x' }, fake.deps),
    ).rejects.toMatchObject({ status: 409 })
    expect(fake.sent).toEqual([])
  })

  test("someone else's conversation is not found and reaches no device", async () => {
    conversation = { userId: 'other', teamId: 't1' }
    const fake = device(null)

    await expect(sessionDock('t1', 'owner', 's1', fake.deps)).rejects.toMatchObject({
      status: 404,
    })
    expect(fake.sent).toEqual([])
  })

  test("a device's error reaches the caller as its text", async () => {
    const fake = device({ isError: true, content: [{ type: 'text', text: 'Update Nuphos' }] })

    await expect(sessionDock('t1', 'owner', 's1', fake.deps)).rejects.toMatchObject({
      status: 409,
      message: 'Update Nuphos',
    })
  })
})

describe('session browser view', () => {
  test("targets the dock's device as its owner, for the conversation's owner only", async () => {
    const fake = device(null)
    const tab = { id: 'tab-1', width: 390, height: 700 }

    expect(await sessionBrowserViewTarget('t1', 'owner', 's1', tab, fake.deps)).toEqual({
      userId: 'owner',
      deviceId: 'mac',
      teamId: 't1',
      sessionId: 's1',
      display: 0,
      viewer: 'owner',
      tab,
    })
    expect(fake.audits).toEqual(['[browser] phone view tab=tab-1'])
    conversation = { userId: 'other', teamId: 't1' }
    await expect(
      sessionBrowserViewTarget('t1', 'owner', 's1', tab, fake.deps),
    ).rejects.toMatchObject({
      status: 404,
    })
  })
})
