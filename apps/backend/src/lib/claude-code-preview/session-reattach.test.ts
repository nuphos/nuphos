import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'

import { registry, sessionsByConversation } from './agent-chat-registry'
import { setClaudeCodeAutonomousUpdateHandler } from './autonomous-session-observer'
import { renewHeldSessions } from './session-holder'
import { observeSession, reattachAfterTransportLoss, untilOnline } from './session-reattach'

import type { OpenAbSessionUpdate } from './openab-acp-client'
import type { TeamPreviewClient, TeamSession } from './team-openab-runtime'

import { localRuntimeUrl } from '@/lib/agent/devices/local-runtime/address'
import { tunnelBus } from '@/lib/agent/devices/local-runtime/bus'
import { runtimePresenceStore } from '@/lib/agent/devices/local-runtime/presence'
import { holderChannel } from '@/lib/agent/devices/local-runtime/protocol'
import * as lifecycle from '@/lib/lifecycle'
import { replicaId } from '@/lib/redis'
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
// Holder keys; a missing one has lapsed (or was never written).
const keys = new Map<string, string>()
const renewed: string[] = []

useRedis({
  withRedis: (op) =>
    op({
      set: async (key: string, value: string) => {
        keys.set(key, value)

        return 'OK'
      },
      // The holder scripts: RENEW names every key, CLAIM one.
      eval: async (script: string, count: number, ...args: string[]) => {
        const names = args.slice(0, count)
        const [key = '', replica = ''] = [names[0], args[count]]

        if (script.includes('ipairs')) {
          renewed.push(...names.filter((name) => keys.get(name) === replica))

          return 0
        }
        const holder = keys.get(key)

        if (holder && holder !== replica) return 0
        keys.set(key, replica)

        return 1
      },
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
  const updates = new Set<(update: OpenAbSessionUpdate) => void>()
  const loads: unknown[][] = []
  const client = {
    name,
    loads,
    emit: (update: OpenAbSessionUpdate) => {
      for (const handler of [...updates]) handler(update)
    },
    onClosed: (handler: () => void) => {
      closed.add(handler)

      return () => closed.delete(handler)
    },
    onRetired: () => () => undefined,
    onSessionUpdate: (_sessionId: string, handler: (update: OpenAbSessionUpdate) => void) => {
      updates.add(handler)

      return () => updates.delete(handler)
    },
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
  keys.clear()
  renewed.length = 0
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
  expect(replacement.loads).toEqual([['sess-1', '/workspace', [], 'context', undefined]])
  expect(await session.reattached).toBe(true)
})

// #704: a Desktop tunnel reconnect drops the shared transport mid-turn. The
// native turn goes on over the reattached transport, so it must stay one
// autonomous turn instead of ending and opening a second "Resumed automatically".
test('a turn in flight continues across a reattach instead of ending', async () => {
  const seen: string[] = []
  const replacement = fakeClient('replacement')

  setClaudeCodeAutonomousUpdateHandler(({ update }) => {
    seen.push(update.kind === 'interrupted' ? `interrupted:${update.reason}` : update.kind)
  })
  acquire = spyOn(registry, 'acquire').mockResolvedValue(replacement)
  const lost = session.client as ReturnType<typeof fakeClient>

  observeSession(session)
  lost.emit({ kind: 'status', status: 'active' })
  lost.emit({ kind: 'text', text: 'Checking the build' })
  lost.close()
  expect(await session.reattached).toBe(true)
  replacement.emit({ kind: 'status', status: 'active' })
  replacement.emit({ kind: 'text', text: ' and it passed.' })
  replacement.emit({ kind: 'status', status: 'idle' })
  await Bun.sleep(5)

  expect(seen).toEqual(['status', 'text', 'status', 'text', 'complete'])
})

test('a turn in flight ends when the session cannot get back on', async () => {
  const seen: string[] = []
  const draining = spyOn(lifecycle, 'isShuttingDown').mockReturnValue(true)

  setClaudeCodeAutonomousUpdateHandler(({ update }) => {
    seen.push(update.kind === 'interrupted' ? `interrupted:${update.reason}` : update.kind)
  })
  acquire = spyOn(registry, 'acquire').mockResolvedValue(fakeClient('replacement'))
  const lost = session.client as ReturnType<typeof fakeClient>

  try {
    observeSession(session)
    lost.emit({ kind: 'status', status: 'active' })
    lost.emit({ kind: 'text', text: 'Checking the build' })
    lost.close()
    expect(await session.reattached).toBe(false)
    await Bun.sleep(5)
  } finally {
    draining.mockRestore()
  }

  expect(seen).toEqual(['status', 'text', 'interrupted:runtime_connection_lost'])
})

test('a turn in flight ends when the reattach finds the agent gone', async () => {
  const seen: string[] = []
  const replacement = fakeClient('replacement', false)

  setClaudeCodeAutonomousUpdateHandler(({ update }) => {
    seen.push(update.kind === 'interrupted' ? `interrupted:${update.reason}` : update.kind)
  })
  acquire = spyOn(registry, 'acquire').mockResolvedValue(replacement)
  const lost = session.client as ReturnType<typeof fakeClient>

  observeSession(session)
  lost.emit({ kind: 'status', status: 'active' })
  lost.emit({ kind: 'text', text: 'Checking the build' })
  lost.close()
  expect(await session.reattached).toBe(true)
  await Bun.sleep(5)

  expect(seen).toEqual(['status', 'text', 'interrupted:runtime_connection_lost'])
})

test('a teammate’s session on the owner’s computer is still theirs to resume after a blip', async () => {
  const mac = { userId: 'owner', deviceId: 'mac', provider: 'claude-code' } as const
  const replacement = fakeClient('replacement')

  // The owner's turns attached the session; the teammate's turn opened this one.
  attachment = { openabSessionId: 'sess-1', runtimeUrl: localRuntimeUrl(mac, 'team') }
  session.endpoint = { ...endpoint, url: localRuntimeUrl(mac, 'team', 'teammate') }
  acquire = spyOn(registry, 'acquire').mockResolvedValue(replacement)
  const lost = session.client as ReturnType<typeof fakeClient>

  observeSession(session)
  lost.close()
  await Bun.sleep(5)

  expect(session.client).toBe(replacement)
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

// #2360: replicas that served the conversation earlier still hold it. Only the
// one that took it last gets it back; another would take its output away and
// keep a turn of its own open that nothing ever ends.
test('leaves a session alone once another replica took it', async () => {
  acquire = spyOn(registry, 'acquire').mockResolvedValue(fakeClient('replacement'))
  keys.set('agent:openab-session-holder:sess-1', 'another-replica')
  const lost = session.client

  expect(await reattachAfterTransportLoss(session, lost, [0], instant)).toBe(false)
  expect(acquire).not.toHaveBeenCalled()
  expect(session.client).toBe(lost)
})

test('the replica that took the session last gets it back', async () => {
  const replacement = fakeClient('replacement')

  acquire = spyOn(registry, 'acquire').mockResolvedValue(replacement)
  observeSession(session)

  expect(await reattachAfterTransportLoss(session, session.client, [0], instant)).toBe(true)
  expect(session.client).toBe(replacement)
})

// A rollout replaces the replica that held the session; its claim lapses
// unrenewed, and a surviving replica takes the session back on.
test('a survivor takes the session back once the holder’s claim lapsed', async () => {
  const replacement = fakeClient('replacement')

  acquire = spyOn(registry, 'acquire').mockResolvedValue(replacement)

  expect(await reattachAfterTransportLoss(session, session.client, [0], instant)).toBe(true)
  expect(session.client).toBe(replacement)
  expect(keys.get('agent:openab-session-holder:sess-1')).toBe(replicaId)
})

test('a replica renews only the claims it still holds', async () => {
  acquire = spyOn(registry, 'acquire')
  const other = { ...session, conversationId: 'conv-2', openabSessionId: 'sess-2' }

  sessionsByConversation.set('team:conv-2', other)
  keys.set('agent:openab-session-holder:sess-1', replicaId)
  keys.set('agent:openab-session-holder:sess-2', 'another-replica')
  await renewHeldSessions()
  sessionsByConversation.delete('team:conv-2')

  expect(renewed).toEqual(['agent:openab-session-holder:sess-1'])
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

test('a reattach that finds the session moved on writes nothing, even after failures', async () => {
  // Attempt 1 cannot connect; by attempt 2 the conversation uses another
  // runtime session. That session's holder owns its story now.
  const warn = spyOn(console, 'warn').mockImplementation(() => {})

  acquire = spyOn(registry, 'acquire').mockImplementationOnce(async () => {
    attachment = { openabSessionId: 'sess-2', runtimeUrl: endpoint.url }
    throw new Error('Failed to connect')
  })

  try {
    expect(await reattachAfterTransportLoss(session, session.client, [0, 0], instant)).toBe(false)
    expect(acquire).toHaveBeenCalledTimes(1)
    expect(workLost).toBeNull()
    expect(warn).not.toHaveBeenCalled()
  } finally {
    warn.mockRestore()
  }
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

test('a stale waiter that wakes after a newer reattach succeeded changes nothing', async () => {
  // The waiter for an offline computer can sleep for hours. A newer reattach
  // (or a turn) put the session on a live transport meanwhile; the old waiter
  // wakes at the computer's heartbeat and must leave everything as it is.
  const url = localRuntimeUrl(computer, 'team')
  const lost = fakeClient('lost')
  const newer = fakeClient('newer')
  const warn = spyOn(console, 'warn').mockImplementation(() => {})

  session.endpoint = { ...endpoint, url }
  session.client = lost
  attachment = { openabSessionId: 'sess-1', runtimeUrl: url }
  acquire = spyOn(registry, 'acquire').mockRejectedValue(
    new Error('The computer running this agent is offline'),
  )

  try {
    const stale = reattachAfterTransportLoss(session, lost, [0, 1, 1])

    await Bun.sleep(30)
    session.client = newer
    await heartbeat()

    expect(await stale).toBe(false)
    expect(acquire).toHaveBeenCalledTimes(1)
    expect(session.client).toBe(newer)
    expect(newer.loads).toEqual([])
    expect(workLost).toBeNull()
    expect(warn).not.toHaveBeenCalled()
  } finally {
    warn.mockRestore()
  }
})
