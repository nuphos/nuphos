import { beforeEach, describe, expect, test } from 'bun:test'

import { useRedis } from '@/lib/test/doubles/redis'
import { useFakeRuntimeRequests } from '@/lib/test/doubles/runtime-request-store'

// Just enough of ioredis for the waiter: string keys with TTL (ignored) and sets.
class FakeRedis {
  strings = new Map<string, string>()
  sets = new Map<string, Set<string>>()

  async get(key: string) {
    return this.strings.get(key) ?? null
  }

  async set(key: string, value: string, ...flags: unknown[]) {
    if (flags.includes('NX') && this.strings.has(key)) return null
    this.strings.set(key, value)

    return 'OK'
  }

  async del(key: string) {
    return this.strings.delete(key) ? 1 : 0
  }

  async expire() {
    return 1
  }

  async sadd(key: string, member: string) {
    const set = this.sets.get(key) ?? new Set<string>()

    set.add(member)
    this.sets.set(key, set)

    return 1
  }

  async srem(key: string, member: string) {
    return this.sets.get(key)?.delete(member) ? 1 : 0
  }

  async smembers(key: string) {
    return [...(this.sets.get(key) ?? [])]
  }
}

const redis = new FakeRedis()
let redisOn = true

useRedis({
  redisEnabled: () => redisOn,
  withRedis: async (op) => (redisOn ? op(redis as never) : null),
})

const {
  awaitPreviewDecision,
  findPreviewWaitByRef,
  listPendingPreviewWaits,
  registerPreviewWait,
  resetLocalPreviewWaits,
  resolvePreviewDecision,
  resolvePreviewDecisionByRef,
  supersedePendingAgentPermissions,
} = await import('./decision-waiter')

beforeEach(() => {
  redis.strings.clear()
  redis.sets.clear()
  resetLocalPreviewWaits()
  redisOn = true
})

describe('preview decision waiter', () => {
  test('a registered wait is pending until resolved, then the waiter returns the payload', async () => {
    const wait = await registerPreviewWait({
      userId: 'u1',
      sessionId: 's1',
      kind: 'permission-grant',
      ref: 'plan-9',
    })

    expect((await listPendingPreviewWaits('u1', 's1')).map((w) => w.waitId)).toEqual([wait.waitId])

    const waiting = awaitPreviewDecision({
      userId: 'u1',
      sessionId: 's1',
      waitId: wait.waitId,
      pollMs: 5,
    })

    expect(
      await resolvePreviewDecision({
        userId: 'u1',
        sessionId: 's1',
        waitId: wait.waitId,
        payload: { decision: 'approved' },
        streamId: 'stream-2',
      }),
    ).toBe(true)

    const outcome = await waiting

    expect(outcome).toMatchObject({
      timedOut: false,
      decision: { payload: { decision: 'approved' }, streamId: 'stream-2' },
    })
    expect(await listPendingPreviewWaits('u1', 's1')).toEqual([])
  })

  test('resolution is idempotent — the first decision wins', async () => {
    const wait = await registerPreviewWait({ userId: 'u1', sessionId: 's1', kind: 'client-tool' })
    const first = await resolvePreviewDecision({
      userId: 'u1',
      sessionId: 's1',
      waitId: wait.waitId,
      payload: { output: 'one' },
    })
    const second = await resolvePreviewDecision({
      userId: 'u1',
      sessionId: 's1',
      waitId: wait.waitId,
      payload: { output: 'two' },
    })

    expect([first, second]).toEqual([true, false])
    const outcome = await awaitPreviewDecision({
      userId: 'u1',
      sessionId: 's1',
      waitId: wait.waitId,
      pollMs: 5,
    })

    expect(outcome).toMatchObject({ decision: { payload: { output: 'one' } } })
  })

  test('stops waiting and clears the wait once the turn is stopped', async () => {
    const wait = await registerPreviewWait({
      userId: 'u1',
      sessionId: 's1',
      kind: 'agent-permission',
      ref: 'tool-call-stopped',
    })
    const stop = new AbortController()
    const waiting = awaitPreviewDecision({
      userId: 'u1',
      sessionId: 's1',
      waitId: wait.waitId,
      pollMs: 5,
      signal: stop.signal,
    })

    stop.abort()

    expect(await waiting).toEqual({ timedOut: true, reason: 'aborted' })
    expect(await listPendingPreviewWaits('u1', 's1')).toEqual([])
  })

  test('a stop wins over an approval that raced it', async () => {
    const wait = await registerPreviewWait({
      userId: 'u1',
      sessionId: 's1',
      kind: 'agent-permission',
      ref: 'tool-call-raced',
    })
    const stop = new AbortController()

    await resolvePreviewDecision({
      userId: 'u1',
      sessionId: 's1',
      waitId: wait.waitId,
      payload: { decision: 'approved' },
    })
    stop.abort()

    expect(
      await awaitPreviewDecision({
        userId: 'u1',
        sessionId: 's1',
        waitId: wait.waitId,
        signal: stop.signal,
      }),
    ).toEqual({ timedOut: true, reason: 'aborted' })
  })

  test('times out and clears the pending wait', async () => {
    const wait = await registerPreviewWait({
      userId: 'u1',
      sessionId: 's1',
      kind: 'agent-permission',
      ref: 'tool-call-1',
    })
    const outcome = await awaitPreviewDecision({
      userId: 'u1',
      sessionId: 's1',
      waitId: wait.waitId,
      timeoutMs: 20,
      pollMs: 5,
    })

    expect(outcome).toEqual({ timedOut: true, reason: 'timeout' })
    expect(await listPendingPreviewWaits('u1', 's1')).toEqual([])
    expect(await findPreviewWaitByRef('agent-permission', 'tool-call-1')).toBeNull()
    expect(
      await resolvePreviewDecisionByRef({
        kind: 'agent-permission',
        ref: 'tool-call-1',
        payload: { decision: 'approved' },
      }),
    ).toBe(false)
  })

  test('decision routes resolve by entity reference', async () => {
    await registerPreviewWait({
      userId: 'u1',
      sessionId: 's1',
      kind: 'permission-grant',
      ref: 'proposal-3',
    })

    expect((await findPreviewWaitByRef('permission-grant', 'proposal-3'))?.kind).toBe(
      'permission-grant',
    )
    expect(
      await resolvePreviewDecisionByRef({
        kind: 'permission-grant',
        ref: 'proposal-3',
        payload: { decision: 'rejected' },
      }),
    ).toBe(true)
    expect(await findPreviewWaitByRef('permission-grant', 'proposal-3')).toBeNull()
    expect(
      await resolvePreviewDecisionByRef({ kind: 'permission-grant', ref: 'nope', payload: {} }),
    ).toBe(false)
  })

  test('a new message supersedes only pending agent permissions in that actor session', async () => {
    const permission = await registerPreviewWait({
      userId: 'actor-1',
      sessionId: 'conversation-1',
      kind: 'agent-permission',
      ref: 'tool-1',
    })

    await registerPreviewWait({
      userId: 'actor-1',
      sessionId: 'conversation-1',
      kind: 'permission-grant',
      ref: 'plan-1',
    })
    await registerPreviewWait({
      userId: 'actor-2',
      sessionId: 'conversation-1',
      kind: 'agent-permission',
      ref: 'tool-2',
    })

    expect(
      await supersedePendingAgentPermissions({
        userId: 'actor-1',
        sessionId: 'conversation-1',
        supersededByUserId: 'actor-2',
      }),
    ).toBe(1)
    expect(
      await awaitPreviewDecision({
        userId: 'actor-1',
        sessionId: 'conversation-1',
        waitId: permission.waitId,
        pollMs: 5,
      }),
    ).toMatchObject({
      timedOut: false,
      decision: {
        payload: {
          decision: 'rejected',
          reason: 'superseded_by_user_message',
          supersededByUserId: 'actor-2',
        },
      },
    })

    expect(
      (await listPendingPreviewWaits('actor-1', 'conversation-1')).map((wait) => wait.kind),
    ).toEqual(['permission-grant'])
    expect(await listPendingPreviewWaits('actor-2', 'conversation-1')).toHaveLength(1)
  })

  test('uses runtime decisions when Redis routing is unavailable', async () => {
    redisOn = false
    const wait = await registerPreviewWait({
      userId: 'u2',
      sessionId: 's2',
      kind: 'permission-grant',
      ref: 'p',
    })

    expect(await listPendingPreviewWaits('u2', 's2')).toHaveLength(1)
    const waiting = awaitPreviewDecision({
      userId: 'u2',
      sessionId: 's2',
      waitId: wait.waitId,
      pollMs: 5,
    })

    await resolvePreviewDecisionByRef({
      kind: 'permission-grant',
      ref: 'p',
      payload: { decision: 'approved' },
    })
    expect(await waiting).toMatchObject({ decision: { payload: { decision: 'approved' } } })
    expect(await listPendingPreviewWaits('u2', 's2')).toEqual([])
  })
})

const runtimeRequests = useFakeRuntimeRequests()

test('a cached route cannot invent a decision when runtime is unavailable', async () => {
  await registerPreviewWait({ userId: 'u', sessionId: 's', kind: 'permission-grant', ref: 'p' })
  runtimeRequests.disconnect()
  await expect(findPreviewWaitByRef('permission-grant', 'p')).rejects.toThrow('Runtime unavailable')
})
test('runtime restart removes the pending request even if Redis retains its route', async () => {
  await registerPreviewWait({ userId: 'u', sessionId: 's', kind: 'permission-grant', ref: 'p' })
  runtimeRequests.restart()
  expect(await findPreviewWaitByRef('permission-grant', 'p')).toBeNull()
  expect(await listPendingPreviewWaits('u', 's')).toEqual([])
})
