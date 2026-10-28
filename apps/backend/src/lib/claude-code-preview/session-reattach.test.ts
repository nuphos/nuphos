import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'

import { registry, sessionsByConversation } from './agent-chat-registry'
import { observeSession, reattachAfterTransportLoss, untilOnline } from './session-reattach'

import type { TeamPreviewClient, TeamSession } from './team-openab-runtime'

import { localRuntimeUrl } from '@/lib/agent/devices/local-runtime/address'
import { tunnelBus } from '@/lib/agent/devices/local-runtime/bus'
import { runtimePresenceStore } from '@/lib/agent/devices/local-runtime/presence'
import { holderChannel } from '@/lib/agent/devices/local-runtime/protocol'
import * as lifecycle from '@/lib/lifecycle'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useRedis } from '@/lib/test/doubles/redis'

const endpoint = {
  url: 'wss://runtime.invalid/acp',
  authKey: 'fixture',
  provider: 'claude-code' as const,
}
let attachment: { openabSessionId: string; runtimeUrl: string; forceNew?: boolean } | null

let attachmentError: Error | null = null
let attachmentErrorOnce = false
let workLost: string | null = null
const handoffs = new Map<string, string>()

useRedis({
  withRedis: (op) =>
    op({
      hset: async (_key: string, fields: Record<string, string>) => {
        for (const [field, value] of Object.entries(fields)) handoffs.set(field, value)

        return Object.keys(fields).length
      },
      del: async () => 0,
    } as never),
})

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
  handoffs.clear()
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
  expect(await session.reattached).toBe(true)
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
  const error = spyOn(console, 'error').mockImplementation(() => {})
  const warn = spyOn(console, 'warn').mockImplementation(() => {})

  acquire = spyOn(registry, 'acquire')
    .mockRejectedValueOnce(new Error('Failed to connect'))
    .mockResolvedValue(fakeClient('replacement'))

  try {
    expect(await reattachAfterTransportLoss(session, session.client, [0, 0], instant)).toBe(true)
    expect(workLost).toBeNull()
    expect(error).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  } finally {
    error.mockRestore()
    warn.mockRestore()
  }
})

test('an offline computer logs no error per retry, and one warning when reattach gives up', async () => {
  // A computer going offline is expected; every retry failing must not flood
  // the error log the backend error-volume alert watches.
  const error = spyOn(console, 'error').mockImplementation(() => {})
  const warn = spyOn(console, 'warn').mockImplementation(() => {})

  acquire = spyOn(registry, 'acquire').mockRejectedValue(
    new Error('The computer running this agent is offline'),
  )

  try {
    expect(await reattachAfterTransportLoss(session, session.client, [0, 0, 0], instant)).toBe(
      false,
    )
    expect(acquire).toHaveBeenCalledTimes(3)
    expect(error).not.toHaveBeenCalled()
    expect(warn.mock.calls.map(([line]) => JSON.parse(String(line)))).toEqual([
      expect.objectContaining({ event: 'agent.openab_session.reattach_failed', attempts: 3 }),
    ])
  } finally {
    error.mockRestore()
    warn.mockRestore()
  }
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

test('a session another transport resumed meanwhile is not reported lost', async () => {
  // The wait for an offline computer can be long; if a turn resumed the same
  // runtime session elsewhere in the meantime, its work goes on there.
  acquire = spyOn(registry, 'acquire').mockImplementationOnce(async () => {
    session.client = fakeClient('resumed-by-a-turn')
    throw new Error('The computer running this agent is offline')
  })
  const lost = fakeClient('lost')

  session.client = lost
  expect(await reattachAfterTransportLoss(session, lost, [0, 0], instant)).toBe(false)
  expect(workLost).toBeNull()
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

// A rollout drains the replica that runs a turn while the device tunnel drops.
// The runtime keeps the turn going and waits 30 s for an output connection
// before cancelling its tool permission requests, so the session must reach a
// live replica now, not when the drain ends minutes later.
test('a draining replica hands a lost session on at once instead of dropping it', async () => {
  const draining = spyOn(lifecycle, 'isShuttingDown').mockReturnValue(true)

  acquire = spyOn(registry, 'acquire').mockResolvedValue(fakeClient('replacement'))
  try {
    observeSession(session)
    ;(session.client as ReturnType<typeof fakeClient>).close()
    expect(await session.reattached).toBe(false)
  } finally {
    draining.mockRestore()
  }

  expect(acquire).not.toHaveBeenCalled()
  expect(JSON.parse(handoffs.get('team:conv') ?? 'null')).toMatchObject({
    teamId: 'team',
    conversationId: 'conv',
    ownerUserId: 'user',
    actorUserId: 'user',
  })
  expect(workLost).toBeNull()
})

test('a draining replica does not hand on a session that moved elsewhere', async () => {
  const draining = spyOn(lifecycle, 'isShuttingDown').mockReturnValue(true)

  attachment = { openabSessionId: 'sess-1', runtimeUrl: 'wss://elsewhere.invalid/acp' }
  acquire = spyOn(registry, 'acquire')
  try {
    expect(await reattachAfterTransportLoss(session, session.client, [0], instant)).toBe(false)
  } finally {
    draining.mockRestore()
  }

  expect(handoffs.size).toBe(0)
})

const computer = { userId: 'owner', deviceId: 'laptop', provider: 'claude-code' as const }
const heartbeat = () =>
  tunnelBus().publish(
    holderChannel(computer.userId, computer.deviceId),
    JSON.stringify({ t: 'ping', conn: 'tunnel-2' }),
  )

test('a computer that comes back after any outage gets its session back on its own', async () => {
  // Every attempt while the computer is offline used to spend a retry, so an
  // outage longer than the retry window left the session off the air until
  // someone reopened the chat. Attempts now wait for the computer instead.
  const url = localRuntimeUrl(computer, 'team')
  const replacement = fakeClient('replacement')

  session.endpoint = { ...endpoint, url }
  attachment = { openabSessionId: 'sess-1', runtimeUrl: url }
  acquire = spyOn(registry, 'acquire')
    .mockRejectedValueOnce(new Error('The computer running this agent is offline'))
    .mockResolvedValue(replacement)

  const reattached = reattachAfterTransportLoss(session, session.client, [0, 1, 1])

  await Bun.sleep(30)
  expect(acquire).toHaveBeenCalledTimes(1)
  expect(workLost).toBeNull()

  await heartbeat()
  expect(await reattached).toBe(true)
  expect(session.client).toBe(replacement)
  expect(workLost).toBeNull()
})

test('untilOnline returns at once for a cloud runtime or a computer whose tunnel is open', async () => {
  await untilOnline(endpoint.url)
  // A tunnel claims the computer, then its first report marks it seen.
  await runtimePresenceStore().claim(computer.userId, computer.deviceId, 'c')
  await runtimePresenceStore().put(computer.userId, computer.deviceId, {
    conn: 'c',
    seenAt: Date.now(),
  })
  try {
    await untilOnline(localRuntimeUrl(computer, 'team'))
  } finally {
    await runtimePresenceStore().clear(computer.userId, computer.deviceId, 'c')
  }
  acquire = spyOn(registry, 'acquire')
})
