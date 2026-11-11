import { beforeEach, describe, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'

import { fetchThroughDock, invalidDockFetch } from './session-dock-proxy'

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

const page = {
  status: 200,
  url: 'http://localhost:3000/',
  headers: { 'content-type': 'text/html' },
  body: 'aGk=',
}

describe('the dock proxy', () => {
  test("fetches one request of the phone's page from the owner's Mac", async () => {
    const fake = device({ content: [{ type: 'text', text: JSON.stringify(page) }] })
    const request = {
      url: 'http://localhost:3000/',
      method: 'GET',
      headers: { accept: 'text/html' },
      document: true,
    }

    expect(await fetchThroughDock('t1', 'owner', 's1', request, fake.deps)).toEqual(page)
    expect(fake.sent[0]).toMatchObject({
      action: 'fetch',
      team: 't1',
      url: 'http://localhost:3000/',
      method: 'GET',
      headers: { accept: 'text/html' },
    })
    expect(fake.sent[0]).not.toHaveProperty('document')
    expect(new Set(fake.audits)).toEqual(new Set(['[browser] phone open http://localhost:3000/']))
  })

  test("a page's own assets are not audited one by one", async () => {
    const fake = device({ content: [{ type: 'text', text: JSON.stringify(page) }] })

    await fetchThroughDock(
      't1',
      'owner',
      's1',
      { url: 'http://localhost:3000/app.js', method: 'GET', headers: {}, document: false },
      fake.deps,
    )
    expect(fake.audits).toEqual([])
  })

  test("someone else's conversation reaches no device; the Mac's refusal reads as its text", async () => {
    conversation = { userId: 'other', teamId: 't1' }
    const fake = device(null)
    const request = { url: 'http://localhost:3000/', method: 'GET', headers: {}, document: true }

    await expect(fetchThroughDock('t1', 'owner', 's1', request, fake.deps)).rejects.toMatchObject({
      status: 404,
    })
    expect(fake.sent).toEqual([])
    conversation = { userId: 'owner', teamId: 't1' }
    const refusing = device({ isError: true, content: [{ type: 'text', text: 'not in the dock' }] })

    await expect(
      fetchThroughDock('t1', 'owner', 's1', request, refusing.deps),
    ).rejects.toMatchObject({
      status: 502,
      message: 'not in the dock',
    })
  })

  test('only http(s), a known method, a few string headers and a bounded body', () => {
    const ok = { url: 'http://localhost:3000/', method: 'GET', headers: {} }

    expect(invalidDockFetch(ok)).toBeUndefined()
    expect(invalidDockFetch({ ...ok, url: 'file:///etc/hosts' })).toBeDefined()
    expect(invalidDockFetch({ ...ok, method: 'CONNECT' })).toBeDefined()
    expect(
      invalidDockFetch({ ...ok, headers: { a: 1 } as unknown as Record<string, string> }),
    ).toBeDefined()
    expect(invalidDockFetch({ ...ok, body: 'x'.repeat(6 * 1024 * 1024) })).toBeDefined()
  })
})
