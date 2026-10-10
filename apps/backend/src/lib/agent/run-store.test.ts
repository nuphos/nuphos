import { beforeEach, describe, expect, test } from 'bun:test'

import { RUNTIME_HANDOFFS_KEY } from '@/lib/claude-code-preview/runtime-handoff-store'
import { useRedis } from '@/lib/test/doubles/redis'

import { sweepAbandonedAgentRuns } from './run-store/ownership'

import type { real as realRedis } from '@/lib/test/doubles/redis'

// run-store pulls in braintrust → config, which eagerly validates a couple of
// env vars. Provide throwaway values so importing the module under test doesn't
// require a real backend environment.
process.env.MONGODB_URI ??= 'mongodb://localhost:27017'

// Regression coverage: a Slack run whose stream failed to start
// (chat.startStream user_not_found) — or any run whose owning replica dies
// without releasing — left the `agentrun-active` busy-guard keys set. Because
// those keys carried the 2h stream-buffer TTL, the customer stayed blocked
// behind "busy rn" for hours. The fix bounds the busy-guard keys to a short,
// heartbeat-refreshed TTL so a stuck session self-heals.
//
// These tests drive the *real* run-store functions against an in-memory Redis
// with a logical clock, so they assert observable busy-guard behaviour (is the
// session still claimable?) rather than the literal TTL constants — which is why
// the same file reproduces the bug on the old code and passes on the new code.

type Entry =
  | { type: 'string'; value: string; expireAt: number | null }
  | { type: 'hash'; value: Map<string, string>; expireAt: number | null }

class FakeRedis {
  private store = new Map<string, Entry>()
  private now = 0

  reset() {
    this.store.clear()
    this.now = 0
  }

  /** Advance the logical clock. Keys expire lazily on next access. */
  advance(ms: number) {
    this.now += ms
  }

  private live(key: string): Entry | undefined {
    const e = this.store.get(key)

    if (!e) return undefined
    if (e.expireAt !== null && e.expireAt <= this.now) {
      this.store.delete(key)

      return undefined
    }

    return e
  }

  private ttlToExpireAt(ttlSec: unknown): number {
    return this.now + Number(ttlSec) * 1000
  }

  set(key: string, value: string, ...opts: string[]): Promise<'OK' | null> {
    if (opts.includes('NX') && this.live(key)) return Promise.resolve(null)
    const exIdx = opts.indexOf('EX')
    const expireAt = exIdx >= 0 ? this.ttlToExpireAt(opts[exIdx + 1]) : null

    this.store.set(key, { type: 'string', value, expireAt })

    return Promise.resolve('OK')
  }

  get(key: string): Promise<string | null> {
    const e = this.live(key)

    return Promise.resolve(e && e.type === 'string' ? e.value : null)
  }

  exists(key: string): Promise<number> {
    return Promise.resolve(this.live(key) ? 1 : 0)
  }

  // No stream type in the fake: the resume tests only exercise runs whose
  // Redis stream never existed, so an empty range is always correct.
  xrange(_key: string, _start: string, _end: string): Promise<[string, string[]][]> {
    return Promise.resolve([])
  }

  del(key: string): Promise<number> {
    const existed = Boolean(this.live(key))

    this.store.delete(key)

    return Promise.resolve(existed ? 1 : 0)
  }

  private hash(key: string): Map<string, string> {
    let e = this.live(key)

    if (!e || e.type !== 'hash') {
      e = { type: 'hash', value: new Map(), expireAt: null }
      this.store.set(key, e)
    }

    return e.value
  }

  hset(key: string, field: string, value: string): Promise<number> {
    this.hash(key).set(field, value)

    return Promise.resolve(1)
  }

  hsetnx(key: string, field: string, value: string): Promise<number> {
    const h = this.hash(key)

    if (h.has(field)) return Promise.resolve(0)
    h.set(field, value)

    return Promise.resolve(1)
  }

  hmget(key: string, ...fields: string[]): Promise<(string | null)[]> {
    const e = this.live(key)

    if (!e || e.type !== 'hash') return Promise.resolve(fields.map(() => null))

    return Promise.resolve(fields.map((f) => e.value.get(f) ?? null))
  }

  // Real semantics matter here: the busy-guard staleness check reads the hash's
  // remaining TTL, and distinguishes "no expiry" (-1) and "no key" (-2) from a
  // decayed one.
  pttl(key: string): Promise<number> {
    const e = this.live(key)

    if (!e) return Promise.resolve(-2)
    if (e.expireAt === null) return Promise.resolve(-1)

    return Promise.resolve(e.expireAt - this.now)
  }

  expire(key: string, ttlSec: number): Promise<number> {
    const e = this.live(key)

    if (!e) return Promise.resolve(0)
    e.expireAt = this.ttlToExpireAt(ttlSec)

    return Promise.resolve(1)
  }

  // Only the run-store Lua scripts reach here; branch on their shape rather
  // than interpreting Lua. They compare ownership before refreshing/deleting.
  eval(script: string, numKeys: number, ...args: string[]): Promise<number> {
    const keys = args.slice(0, numKeys)
    const argv = args.slice(numKeys)
    const key = keys[0]!

    if (script.includes('HSETNX')) {
      const e = this.live(key)
      const ttl = e?.expireAt == null ? -1 : e.expireAt - this.now

      if (
        !e ||
        e.type !== 'hash' ||
        e.value.get('streamId') !== argv[0] ||
        this.live(keys[1]!) ||
        ttl < 0 ||
        ttl > Number(argv[1])
      )
        return Promise.resolve(0)
      const team = e.value.get('teamId')

      if (team) {
        void this.hsetnx(
          keys[2]!,
          `${team}:${argv[3]}`,
          JSON.stringify({
            teamId: team,
            conversationId: argv[3],
            ownerUserId: argv[2],
            actorUserId: e.value.get('actorUserId') ?? argv[2],
            locale: 'en-US',
            at: Number(argv[4]),
            abandonedStreamId: argv[0],
          }),
        )
      }
      this.store.delete(key)

      return Promise.resolve(1)
    }
    if (script.includes('HGET')) {
      const e = this.live(key)

      if (e && e.type === 'hash' && e.value.get(argv[0]!) === argv[1]) {
        this.store.delete(key)

        return Promise.resolve(1)
      }

      return Promise.resolve(0)
    }
    const e = this.live(key)

    if (e && e.type === 'string' && e.value === argv[0]) {
      if (script.includes('EXPIRE')) {
        e.expireAt = this.ttlToExpireAt(argv[1])

        return Promise.resolve(1)
      }
      this.store.delete(key)

      return Promise.resolve(1)
    }

    return Promise.resolve(0)
  }

  scan(): Promise<[string, string[]]> {
    return Promise.resolve([
      '0',
      [...this.store.keys()].filter(
        (key) => key.startsWith('atlas:agentrun-active:') && this.live(key)?.type === 'hash',
      ),
    ])
  }

  pipeline() {
    const ops: [string, unknown[]][] = []
    const rec: Record<string, (...a: unknown[]) => unknown> = {}

    for (const method of ['set', 'hset', 'hsetnx', 'expire', 'del']) {
      rec[method] = (...a: unknown[]) => {
        ops.push([method, a])

        return rec
      }
    }
    rec.exec = async () => {
      const results: [null, unknown][] = []

      for (const [method, a] of ops) {
        results.push([null, await (this as any)[method](...a)])
      }

      return results
    }

    return rec
  }
}

const redis = new FakeRedis()

// `replicaId` stays real: it is a value export the registry cannot intercept,
// and a process-lifetime constant is all the ownership comparisons need.
useRedis({
  redisEnabled: () => true,
  getRedis: () => redis,
  withRedis: async (op) =>
    op(redis as unknown as Parameters<Parameters<typeof realRedis.withRedis>[0]>[0]),
})

const {
  flushGuardWrites,
  getActiveAgentRunForSession,
  requestAgentRunCancellation,
  reserveActiveAgentRunForSession,
  startAgentRunOwnership,
  streamAgentRunFromRedis,
} = await import('./run-store')

const USER = 'u1'
const SESSION = 's1'
const STREAM = 'stream1'
// The owner lease the run-store writes for this run. Spelled out so a test can
// simulate the one failure the staleness check must NOT act on: a Redis failover
// that loses the lease while the run is still alive.
const OWNER_KEY = `atlas:agentrun:${USER}:${STREAM}:owner`

// Let the fire-and-forget heartbeat pipeline (void write().catch(...)) drain.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

/** True when the busy guard would reject a new turn for this session: the
 *  active-run hash is present, or the reservation cannot be re-acquired. */
async function sessionIsBusy(): Promise<boolean> {
  if ((await getActiveAgentRunForSession(USER, SESSION)) !== null) return true
  // Hash is gone — check the reservation by probing it with NX. A success means
  // the lock was free, so undo the probe immediately.
  const probe = await reserveActiveAgentRunForSession(USER, SESSION, 'probe-token')

  if (probe === null) return true
  probe()
  await flush()

  return false
}

/** Claim the session busy guard exactly the way a Slack turn does: reserve the
 *  session, then start ownership (which writes the active-run hash + heartbeat).
 *  Returns a combined release matching the Slack handler's finally block. */
async function claimSession(): Promise<() => void> {
  const releaseReservation = await reserveActiveAgentRunForSession(USER, SESSION, 'run-token')

  expect(releaseReservation).not.toBeNull()
  const releaseOwnership = startAgentRunOwnership(USER, SESSION, STREAM)

  await flush() // first heartbeat write() lands the active-run hash

  return () => {
    releaseOwnership()
    releaseReservation?.()
  }
}

beforeEach(() => {
  redis.reset()
})

describe('distributed agent run cancellation', () => {
  test('does not claim to forward when no replica owns the stream', async () => {
    expect(await requestAgentRunCancellation(USER, STREAM)).toBe(false)
  })

  test('a cancellation request reaches the replica that owns the run', async () => {
    let cancelled = false
    const releaseOwnership = startAgentRunOwnership(USER, SESSION, STREAM, {
      onCancellationRequested: () => {
        cancelled = true
      },
      heartbeatMs: 1,
    })

    try {
      await flush()
      expect(await requestAgentRunCancellation(USER, STREAM)).toBe(true)
      await Bun.sleep(5)
      expect(cancelled).toBe(true)
    } finally {
      releaseOwnership()
    }
  })
})

describe('agent run busy-guard lifecycle (issue #338)', () => {
  test('a live claim keeps its reservation past the initial TTL', async () => {
    const releaseReservation = await reserveActiveAgentRunForSession(
      USER,
      SESSION,
      'long-turn-token',
      { heartbeatMs: 1 },
    )

    expect(releaseReservation).not.toBeNull()

    try {
      // Model a turn that runs longer than the 15s reservation TTL. Give the
      // renewal timer a chance to refresh after each logical-clock step.
      for (let elapsed = 0; elapsed < 20_000; elapsed += 5_000) {
        redis.advance(5_000)
        await Bun.sleep(3)
      }

      expect(await reserveActiveAgentRunForSession(USER, SESSION, 'overlap-token')).toBeNull()
    } finally {
      releaseReservation?.()
      await flush()
    }

    const nextTurn = await reserveActiveAgentRunForSession(USER, SESSION, 'next-turn-token')

    expect(nextTurn).not.toBeNull()
    nextTurn?.()
  })

  test('a fresh claim marks the session busy', async () => {
    const releaseOwnership = await claimSession()

    try {
      expect(await sessionIsBusy()).toBe(true)
    } finally {
      releaseOwnership()
    }
  })

  test('a clean finish releases the guard immediately', async () => {
    const releaseOwnership = await claimSession()

    releaseOwnership()
    await flush()
    // The reservation is released by the Slack handler's finally; model that by
    // re-claiming — the run-store release above already dropped the hash.
    const active = await getActiveAgentRunForSession(USER, SESSION)

    expect(active).toBeNull()
  })

  test(
    'REPRODUCTION: a run that dies without releasing must self-heal within the failsafe window, ' +
      'not stay locked for the 2h stream-buffer TTL',
    async () => {
      // Claim the guard, then simulate the incident: the Slack stream failed and
      // the owning replica went away without running its release (crash / lost
      // pod / missed finally). We never call releaseOwnership during the window,
      // and because the clock is logical the real heartbeat interval never fires
      // — so the guard keys keep the TTL from their initial write.
      const releaseOwnership = await claimSession()

      try {
        // Owner lease is still live, so the guard correctly holds and a
        // concurrent message is rejected.
        redis.advance(10_000) // 10s
        expect(await sessionIsBusy()).toBe(true)

        // Past the owner lease and the reservation, far short of the 2h (7200s)
        // stream TTL and of the 90s hash failsafe. The lease is gone and the
        // hash's TTL has visibly decayed, so the guard is swept on read and the
        // session is claimable again — a Slack thread recovers in ~20s instead
        // of waiting out the failsafe.
        redis.advance(15_000) // now 25s total
        expect(await getActiveAgentRunForSession(USER, SESSION)).toBeNull()
        expect(await sessionIsBusy()).toBe(false)
        const reclaim = await reserveActiveAgentRunForSession(USER, SESSION, 'next-turn-token')

        expect(reclaim).not.toBeNull()
        reclaim?.()
      } finally {
        // The crash window is over — the assertions above already ran, so this
        // only clears the real setInterval startAgentRunOwnership scheduled, and
        // must run even if an assertion threw. It does not undermine the
        // simulation (a no-op DEL on already-expired keys).
        releaseOwnership()
      }
    },
  )

  test('a lost owner lease alone does not sweep a live run (Sentinel failover safety)', async () => {
    const releaseOwnership = await claimSession()

    try {
      // A failover that loses the recently-written lease but keeps the hash: the
      // hash TTL is still fresh, which proves the heartbeat was running, so the
      // guard must hold. Sweeping here would let a second turn start on a
      // session that is still streaming.
      await redis.del(OWNER_KEY)
      expect(await getActiveAgentRunForSession(USER, SESSION)).not.toBeNull()
      expect(await sessionIsBusy()).toBe(true)
    } finally {
      releaseOwnership()
    }
  })

  test('shutdown can flush the release that a terminating replica issued', async () => {
    // The release is fire-and-forget: on SIGTERM the process would close Redis and
    // exit before the DEL landed, stranding the guard. flushGuardWrites is what
    // shutdown awaits so the session is free the moment the pod goes away.
    const releaseOwnership = await claimSession()

    releaseOwnership()
    // Counts releases that actually landed, so the return value can be trusted as
    // "the guard is gone" rather than merely "a write was issued". Both the
    // ownership hash and the independently-renewed reservation are released.
    expect(await flushGuardWrites(1_000)).toBe(2)
    expect(await getActiveAgentRunForSession(USER, SESSION)).toBeNull()
  })

  test('flushing with nothing in flight is a no-op', async () => {
    expect(await flushGuardWrites(1_000)).toBe(0)
  })
})

// Coverage for the orphan-resume fast-fail: a client that reconnects with
// resume(resumeFrom=0) after its original POST died in transit points at a run
// that was never registered anywhere — no Redis stream, no owner lease. The
// resume must fail within the short orphan window (~3s) instead of pinning the
// client on a silent SSE stream for the full 30s attach grace. When an owner
// lease IS present the full grace must still apply (live replica handoffs).
describe('redis resume orphan fast-fail', () => {
  test('a resume for a never-registered run fails fast instead of riding the 30s grace', async () => {
    const startedAt = Date.now()
    const res = await streamAgentRunFromRedis(USER, 'ghost-stream', 0)

    expect(res).not.toBeNull()
    const body = await res!.text()
    const elapsed = Date.now() - startedAt

    expect(body).toContain('stream_unresumable')
    expect(body).toContain('stream_never_registered')
    expect(body).toContain('atlas-stream-done')
    expect(elapsed).toBeLessThan(10_000)
  }, 15_000)

  test('an owner lease keeps the full attach grace (no orphan fast-fail)', async () => {
    await redis.set(`atlas:agentrun:${USER}:handoff-stream:owner`, 'other-replica', 'EX', '60')
    const res = await streamAgentRunFromRedis(USER, 'handoff-stream', 0)

    expect(res).not.toBeNull()
    const reader = res!.body!.getReader()
    const decoder = new TextDecoder()
    let received = ''
    const drain = (async () => {
      while (true) {
        const { value, done } = await reader.read()

        if (done) break
        if (value) received += decoder.decode(value, { stream: true })
      }
    })()

    // Well past the orphan window (6 probes x 500ms) but short of the grace.
    await new Promise((resolve) => setTimeout(resolve, 4_500))
    expect(received).not.toContain('stream_unresumable')
    await reader.cancel()
    await drain.catch(() => {})
  }, 15_000)
})

describe('crashed replica recovery', () => {
  test('queues the original actor once without a connected desktop; live owners are left alone', async () => {
    const release = startAgentRunOwnership(USER, SESSION, STREAM, {
      teamId: 'team',
      actorUserId: 'actor',
      heartbeatMs: 1_000_000,
    })

    try {
      await flush()
      await sweepAbandonedAgentRuns()
      expect(await redis.hmget(RUNTIME_HANDOFFS_KEY, `team:${SESSION}`)).toEqual([null])
      // Model a dead process by moving Redis time beyond both lease/grace,
      // without firing this process's heartbeat.
      redis.advance(25_000)
      await Promise.all([sweepAbandonedAgentRuns(), sweepAbandonedAgentRuns()])
      const [raw] = await redis.hmget(RUNTIME_HANDOFFS_KEY, `team:${SESSION}`)

      expect(JSON.parse(raw!)).toMatchObject({
        teamId: 'team',
        conversationId: SESSION,
        ownerUserId: USER,
        actorUserId: 'actor',
        abandonedStreamId: STREAM,
      })
      expect(await redis.hmget(`atlas:agentrun-active:${USER}:${SESSION}`, 'streamId')).toEqual([
        null,
      ])
      await sweepAbandonedAgentRuns()
      expect(await redis.hmget(RUNTIME_HANDOFFS_KEY, `team:${SESSION}`)).toEqual([raw ?? null])
    } finally {
      release()
      await flush()
    }
  })

  test('a completed turn is never queued for recovery', async () => {
    const release = startAgentRunOwnership(USER, SESSION, STREAM, { teamId: 'team' })

    await flush()
    release()
    await flush()
    redis.advance(25_000)
    await sweepAbandonedAgentRuns()
    expect(await redis.hmget(RUNTIME_HANDOFFS_KEY, `team:${SESSION}`)).toEqual([null])
  })
})
