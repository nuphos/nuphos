// Same init-order guard as the sibling preview tests.
import '@/routes/agent'

import { beforeEach, describe, expect, test } from 'bun:test'

import { agentRuns } from '@/lib/agent/run-admission'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useAgentRunStore } from '@/lib/test/doubles/agent-run-store'
import { useConversationComputer } from '@/lib/test/doubles/conversation-computer'
import { useIdentity } from '@/lib/test/doubles/identity'
import { usePendingMessages } from '@/lib/test/doubles/pending-messages'
import { usePendingQueue } from '@/lib/test/doubles/pending-queue'
import { useRunCancel } from '@/lib/test/doubles/run-cancel'
import { useRuntimeCatalog } from '@/lib/test/doubles/runtime-catalog'

import type { AgentConversation } from '@/lib/agent/db'
import type { PendingUserMessage } from '@/lib/agent/pending-message-types'

const ME = 'a'.repeat(24)
const TEAMMATE = 'b'.repeat(24)
const ctx = { userId: ME }
const session = { sessionId: 's1', userId: ME, teamId: 't1', messageCount: 6 } as AgentConversation

let member: boolean
let readable: AgentConversation | null
let canReply: boolean
let stopped: string[]
let queue: PendingUserMessage[]
let active: { streamId: string } | null
let frames: Record<string, { id: string; frame: string }[]>
// A self-hosted compose stack runs without Redis: runs live in this process only.
let redisOn: boolean

useIdentity({ getTeamMembership: async () => (member ? ({ role: 'MEMBER' } as never) : null) })
useAgentDb({ getReadableConversation: async () => readable })
useConversationComputer({ canReplyIn: async () => canReply })
useRuntimeCatalog({
  listRuntimeInstances: async () => [
    {
      id: 'r1',
      provider: 'claude-code',
      label: 'Claude',
      status: 'active',
      kind: 'external',
      createdAt: '',
    },
    {
      id: 'r3',
      provider: 'claude-code',
      label: 'Laptop',
      status: 'active',
      kind: 'local',
      local: { deviceLabel: 'Laptop', online: false },
      createdAt: '',
    } as never,
    {
      id: 'r2',
      provider: 'codex',
      label: 'Codex',
      status: 'disabled',
      kind: 'external',
      createdAt: '',
    },
  ],
  withRuntimeReadiness: async (_team, instances) => instances,
})
useRunCancel({
  stopConversationTurn: async (conversation) => {
    stopped.push(conversation.sessionId)

    return 'requested'
  },
})
usePendingQueue({ listPendingUserMessages: async () => queue })
usePendingMessages({
  removePendingUserMessage: async (_owner, _session, id) => {
    const found = queue.find((message) => message.id === id)

    queue = queue.filter((message) => message.id !== id)

    return found ?? null
  },
})
useAgentRunStore({
  getActiveAgentRunForSession: async () => (redisOn ? (active as never) : null),
  readAgentRunFramesAfter: async (_owner, streamId, after, count) => {
    if (!redisOn) return null
    const all = frames[streamId] ?? []
    const from = after === '-' ? 0 : all.findIndex((entry) => entry.id === after) + 1

    return all.slice(from, from + count)
  },
})

const { nuphosListRuntimes, nuphosStop, nuphosListQueue, nuphosRemoveQueued, nuphosEvents } =
  await import('./control')
const body = (result: { structuredContent?: unknown }) =>
  result.structuredContent as Record<string, any>
const errorText = (result: { isError?: boolean; content: { type: string; text?: string }[] }) =>
  result.isError ? (result.content[0] as { text: string }).text : undefined
const frame = (event: Record<string, unknown>) => `data: ${JSON.stringify(event)}\n\n`
const waiting = (id: string, actorUserId: string, source = 'mcp') =>
  ({
    id,
    actorUserId,
    source,
    renderedText: `msg ${id}`,
    receivedAt: '2026-11-18T00:00:00Z',
  }) as PendingUserMessage

beforeEach(() => {
  member = true
  readable = session
  canReply = true
  stopped = []
  queue = []
  active = null
  frames = {}
  redisOn = true
  agentRuns.clear()
})

describe('nuphos_list_runtimes', () => {
  test('lists the agents of a team the caller belongs to, with availability', async () => {
    const result = await nuphosListRuntimes({ team_id: 't1' }, ctx)

    expect(body(result).runtimes).toEqual([
      {
        runtime_id: 'r1',
        label: 'Claude',
        agent: 'claude-code',
        kind: 'external',
        available: true,
      },
      {
        runtime_id: 'r3',
        label: 'Laptop',
        agent: 'claude-code',
        kind: 'local',
        available: false,
        computer: 'Laptop',
      },
      { runtime_id: 'r2', label: 'Codex', agent: 'codex', kind: 'external', available: false },
    ])
  })

  test('refuses a team the caller is not a member of', async () => {
    member = false

    expect(errorText(await nuphosListRuntimes({ team_id: 't9' }, ctx))).toContain('not a member')
  })
})

describe('nuphos_stop', () => {
  test('stops a session the caller may reply in', async () => {
    const result = await nuphosStop({ session_id: 's1' }, ctx)

    expect(body(result)).toEqual({ session_id: 's1', status: 'requested' })
    expect(stopped).toEqual(['s1'])
  })

  test('a viewer who cannot reply cannot stop it', async () => {
    canReply = false

    expect(errorText(await nuphosStop({ session_id: 's1' }, ctx))).toContain('only view')
    expect(stopped).toEqual([])
  })

  test('a session the caller cannot read is not found', async () => {
    readable = null

    expect(errorText(await nuphosStop({ session_id: 's1' }, ctx))).toBe('Session not found: s1')
    expect(stopped).toEqual([])
  })
})

describe('nuphos_list_queue and nuphos_remove_queued', () => {
  test('lists the waiting messages in order, marking the caller’s own', async () => {
    queue = [waiting('m1', ME), waiting('m2', TEAMMATE, 'app'), waiting('m3', ME, 'slack.agent')]

    expect(body(await nuphosListQueue({ session_id: 's1' }, ctx)).queued).toEqual([
      { queued_id: 'm1', text: 'msg m1', mine: true, received_at: '2026-11-18T00:00:00.000Z' },
      { queued_id: 'm2', text: 'msg m2', mine: false, received_at: '2026-11-18T00:00:00.000Z' },
    ])
  })

  test('the caller takes back their own MCP message', async () => {
    queue = [waiting('m1', ME)]

    expect(body(await nuphosRemoveQueued({ session_id: 's1', queued_id: 'm1' }, ctx))).toEqual({
      session_id: 's1',
      removed: true,
      text: 'msg m1',
    })
    expect(queue).toEqual([])
  })

  test('nobody takes back a teammate’s message', async () => {
    queue = [waiting('m2', TEAMMATE, 'app')]

    expect(
      errorText(await nuphosRemoveQueued({ session_id: 's1', queued_id: 'm2' }, ctx)),
    ).toContain('Only the person who sent')
    expect(queue).toHaveLength(1)
  })

  test('an unreadable session lists nothing', async () => {
    readable = null
    queue = [waiting('m1', TEAMMATE)]

    expect(errorText(await nuphosListQueue({ session_id: 's1' }, ctx))).toBe(
      'Session not found: s1',
    )
  })
})

describe('nuphos_events', () => {
  test('reads the running turn from its start, then only what came since', async () => {
    active = { streamId: 'st1' }
    frames.st1 = [
      { id: '1-0', frame: frame({ type: 'start' }) },
      { id: '2-0', frame: ': heartbeat\n\n' },
      { id: '3-0', frame: frame({ type: 'text-delta', id: 't', delta: 'Hel' }) },
    ]

    const first = body(await nuphosEvents({ session_id: 's1' }, ctx))

    expect(first.events).toEqual([{ type: 'start' }, { type: 'text-delta', id: 't', delta: 'Hel' }])
    expect(first.cursor).toBe('st1/3-0')
    expect(first.running).toBe(true)

    frames.st1.push({ id: '4-0', frame: frame({ type: 'text-delta', id: 't', delta: 'lo' }) })
    const next = body(await nuphosEvents({ session_id: 's1', cursor: first.cursor }, ctx))

    expect(next.events).toEqual([{ type: 'text-delta', id: 't', delta: 'lo' }])
    expect(next.cursor).toBe('st1/4-0')
  })

  test('a cursor on a turn that has ended moves on to the running one', async () => {
    frames.st1 = [{ id: '1-0', frame: frame({ type: 'finish' }) }]
    frames.st2 = [{ id: '9-0', frame: frame({ type: 'start' }) }]
    active = { streamId: 'st2' }

    const next = body(await nuphosEvents({ session_id: 's1', cursor: 'st1/0-1' }, ctx))

    // The finished turn is read from the transcript; its frames are not served here.
    expect(next).toMatchObject({ turn_ended: true, running: true, cursor: 'st2/9-0' })
    expect(next.events).toEqual([{ type: 'start' }])
  })

  test('a cursor naming another stream reads only this session’s running turn', async () => {
    // Another session's stream of the same owner, which the caller can read elsewhere.
    frames.other = [{ id: '1-0', frame: frame({ type: 'text-delta', id: 't', delta: 'secret' }) }]
    frames.st1 = [{ id: '5-0', frame: frame({ type: 'start' }) }]
    active = { streamId: 'st1' }

    const read = body(await nuphosEvents({ session_id: 's1', cursor: 'other/0-1' }, ctx))

    expect(read.events).toEqual([{ type: 'start' }])
    expect(read.cursor).toBe('st1/5-0')

    active = null
    const idle = body(await nuphosEvents({ session_id: 's1', cursor: 'other/0-1' }, ctx))

    expect(idle).toMatchObject({ events: [], turn_ended: true, running: false })
  })

  test('without Redis, reads the run this process holds by frame position', async () => {
    redisOn = false
    const run = {
      key: 'k',
      userId: ME,
      sessionId: 's1',
      streamId: 'st1',
      done: false,
      createdAt: Date.now(),
      frames: [frame({ type: 'start' }), frame({ type: 'text-delta', id: 't', delta: 'Hi' })],
    }

    agentRuns.set('k', run as never)
    const first = body(await nuphosEvents({ session_id: 's1' }, ctx))

    expect(first.running).toBe(true)
    expect(first.events).toHaveLength(2)
    expect(first.cursor).toBe('st1/2')

    run.frames.push(frame({ type: 'text-delta', id: 't', delta: '!' }))
    const more = body(await nuphosEvents({ session_id: 's1', cursor: first.cursor }, ctx))

    expect(more.events).toEqual([{ type: 'text-delta', id: 't', delta: '!' }])
    expect(more.cursor).toBe('st1/3')

    run.done = true
    // Kept as the place to resume: the next turn is picked up from it.
    expect(body(await nuphosEvents({ session_id: 's1', cursor: more.cursor }, ctx))).toMatchObject({
      events: [],
      running: false,
      turn_ended: true,
      cursor: 'st1/3',
    })
  })

  test('with nothing running there is nothing to read', async () => {
    expect(body(await nuphosEvents({ session_id: 's1' }, ctx))).toEqual({
      session_id: 's1',
      running: false,
      message_count: 6,
      events: [],
      cursor: null,
    })
  })

  test('rejects a cursor it did not issue', async () => {
    expect(errorText(await nuphosEvents({ session_id: 's1', cursor: 'nonsense' }, ctx))).toContain(
      'cursor',
    )
  })

  test('a session the caller cannot read has no events', async () => {
    readable = null
    active = { streamId: 'st1' }
    frames.st1 = [{ id: '1-0', frame: frame({ type: 'start' }) }]

    expect(errorText(await nuphosEvents({ session_id: 's1' }, ctx))).toBe('Session not found: s1')
  })
})
