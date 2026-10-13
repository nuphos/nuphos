import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'

import { registry, sessionsByConversation } from './agent-chat-registry'
import { observeSession, reattachAfterTransportLoss } from './session-reattach'

import type { TeamPreviewClient, TeamSession } from './team-openab-runtime'

import { useAgentDb } from '@/lib/test/doubles/agent-db'

const endpoint = {
  url: 'wss://runtime.invalid/acp',
  authKey: 'fixture',
  provider: 'claude-code' as const,
}
let attachment: { openabSessionId: string; runtimeUrl: string; forceNew?: boolean } | null

let attachmentError: Error | null = null
let attachmentErrorOnce = false
let workLost: string | null = null

useAgentDb({
  getConversationPreviewAttachment: async () => {
    const failure = attachmentError

    if (attachmentErrorOnce) attachmentError = null
    if (failure) throw failure

    return attachment
  },
  markConversationWorkLost: async (_id: string, _team: string, reason: string) => {
    workLost = reason
  },
})

function fakeClient(name: string, alive = true) {
  const closed = new Set<() => void>()
  const loads: unknown[][] = []
  const client = {
    name,
    loads,
    onClosed: (handler: () => void) => {
      closed.add(handler)

      return () => closed.delete(handler)
    },
    onRetired: () => () => undefined,
    onSessionUpdate: () => () => undefined,
    onSessionPermission: () => () => undefined,
    cancel: () => undefined,
    loadSession: async (...args: unknown[]) => {
      loads.push(args)

      return { alive }
    },
    close: () => {
      for (const handler of [...closed]) handler()
      closed.clear()
    },
  }

  return client as typeof client & TeamPreviewClient
}

let session: TeamSession
let acquire: ReturnType<typeof spyOn>
const instant = async () => undefined

beforeEach(() => {
  workLost = null
  attachmentError = null
  attachmentErrorOnce = false
  attachment = { openabSessionId: 'sess-1', runtimeUrl: endpoint.url }
  session = {
    teamId: 'team',
    conversationId: 'conv',
    userId: 'user',
    locale: 'en-US',
    openabSessionId: 'sess-1',
    endpoint,
    client: fakeClient('lost'),
    mcpServers: [],
    systemPrompt: 'context',
  }
  sessionsByConversation.set('team:conv', session)
})
afterEach(() => {
  acquire.mockRestore()
  sessionsByConversation.delete('team:conv')
})

test('resumes an observed session on a fresh transport when its transport closes', async () => {
  const replacement = fakeClient('replacement')

  acquire = spyOn(registry, 'acquire').mockResolvedValue(replacement)
  const lost = session.client as ReturnType<typeof fakeClient>

  observeSession(session)
  lost.close()
  await Bun.sleep(5)

  expect(session.client).toBe(replacement)
  expect(replacement.loads).toEqual([['sess-1', '/workspace/conv-conv', [], 'context', undefined]])
})

test('keeps retrying while the runtime is unreachable', async () => {
  const replacement = fakeClient('replacement')

  acquire = spyOn(registry, 'acquire')
    .mockRejectedValueOnce(new Error('Failed to connect to OpenAB ACP endpoint'))
    .mockResolvedValue(replacement)

  expect(await reattachAfterTransportLoss(session, session.client, [0, 10], instant)).toBe(true)
  expect(acquire).toHaveBeenCalledTimes(2)
  expect(session.client).toBe(replacement)
})

test('leaves a session alone once its attachment moved elsewhere', async () => {
  acquire = spyOn(registry, 'acquire').mockResolvedValue(fakeClient('replacement'))
  attachment = { openabSessionId: 'sess-2', runtimeUrl: endpoint.url }
  const lost = session.client

  expect(await reattachAfterTransportLoss(session, lost, [0], instant)).toBe(false)
  expect(acquire).not.toHaveBeenCalled()
  expect(session.client).toBe(lost)
})

test('does not replace a transport a turn already moved the session to', async () => {
  acquire = spyOn(registry, 'acquire').mockResolvedValue(fakeClient('replacement'))
  const lost = session.client

  session.client = fakeClient('turn')

  expect(await reattachAfterTransportLoss(session, lost, [0], instant)).toBe(false)
  expect(acquire).not.toHaveBeenCalled()
})

test('a reattach that finds the inner agent gone marks the loss for the next prompt', async () => {
  const replacement = fakeClient('replacement', false)

  acquire = spyOn(registry, 'acquire').mockResolvedValue(replacement)

  expect(await reattachAfterTransportLoss(session, session.client, [0], instant)).toBe(true)
  expect(session.client).toBe(replacement)
  expect(session.innerSessionLost).toBe(true)
  expect(workLost).toBe('session_lost')
})

test('a reattach onto a live inner agent leaves nothing to report', async () => {
  acquire = spyOn(registry, 'acquire').mockResolvedValue(fakeClient('replacement'))

  expect(await reattachAfterTransportLoss(session, session.client, [0], instant)).toBe(true)
  expect(session.innerSessionLost).toBeUndefined()
  expect(workLost).toBeNull()
})

test('a runtime that stays unreachable is reported as lost contact, not certain death', async () => {
  // The runtime pod was replaced; every retry fails to connect. Nothing here
  // ever reaches a resume, so the in-memory mark is never set — and the pod
  // that watched this is not the one the next prompt lands on.
  acquire = spyOn(registry, 'acquire').mockRejectedValue(new Error('Failed to connect'))

  expect(await reattachAfterTransportLoss(session, session.client, [0, 0], instant)).toBe(false)
  expect(workLost).toBe('unreachable')
})

test('a blip the next attempt recovers from reports nothing', async () => {
  // The session is back on the air, so there is nothing to warn about and no
  // reason to invite a re-run of work that may still be running.
  acquire = spyOn(registry, 'acquire')
    .mockRejectedValueOnce(new Error('Failed to connect'))
    .mockResolvedValue(fakeClient('replacement'))

  expect(await reattachAfterTransportLoss(session, session.client, [0, 0], instant)).toBe(true)
  expect(workLost).toBeNull()
})

test('giving up because the session was superseded still reports the failures seen', async () => {
  // Attempt 1 cannot connect; by attempt 2 the session has moved on, so the
  // loop stops without ever resuming. The failure already seen still counts.
  acquire = spyOn(registry, 'acquire').mockImplementationOnce(async () => {
    attachment = { openabSessionId: 'sess-2', runtimeUrl: endpoint.url }
    throw new Error('Failed to connect')
  })

  expect(await reattachAfterTransportLoss(session, session.client, [0, 0], instant)).toBe(false)
  expect(acquire).toHaveBeenCalledTimes(1)
  expect(workLost).toBe('unreachable')
})

test('a handoff with no runtime failure behind it reports nothing', async () => {
  // Ownership moved on before the first attempt. Nothing was ever observed
  // about the runtime, so the conversation is told nothing.
  acquire = spyOn(registry, 'acquire').mockResolvedValue(fakeClient('replacement'))
  attachment = { openabSessionId: 'sess-2', runtimeUrl: endpoint.url }

  expect(await reattachAfterTransportLoss(session, session.client, [0, 0], instant)).toBe(false)
  expect(acquire).not.toHaveBeenCalled()
  expect(workLost).toBeNull()
})

test('a bookkeeping read that throws is retried, and is no evidence either way', async () => {
  // Ownership is unknown, not lost: the next delay tries again rather than
  // ending reattachment on a database blip.
  const replacement = fakeClient('replacement')

  acquire = spyOn(registry, 'acquire').mockResolvedValue(replacement)
  attachmentError = new Error('Mongo hiccup')
  attachmentErrorOnce = true

  expect(await reattachAfterTransportLoss(session, session.client, [0, 0], instant)).toBe(true)
  expect(session.client).toBe(replacement)
  expect(workLost).toBeNull()
})

test('a bookkeeping read that keeps throwing reports nothing', async () => {
  acquire = spyOn(registry, 'acquire').mockResolvedValue(fakeClient('replacement'))
  attachmentError = new Error('Mongo hiccup')

  expect(await reattachAfterTransportLoss(session, session.client, [0, 0], instant)).toBe(false)
  expect(acquire).not.toHaveBeenCalled()
  expect(workLost).toBeNull()
})

test('a replacement closing during resume does not start a second reattach loop', async () => {
  const broken = fakeClient('broken')
  const healthy = fakeClient('healthy')

  broken.loadSession = async () => {
    broken.close()
    throw new Error('resume connection closed')
  }
  acquire = spyOn(registry, 'acquire').mockResolvedValueOnce(broken).mockResolvedValue(healthy)
  expect(await reattachAfterTransportLoss(session, session.client, [0, 0], instant)).toBe(true)
  expect(acquire).toHaveBeenCalledTimes(2)
  expect(session.client).toBe(healthy)
})
