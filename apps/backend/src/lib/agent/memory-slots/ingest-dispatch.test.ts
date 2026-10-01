// T-Phase2: the runtime ingest dispatcher that replaces the finalizer's
// distill block in the call-site swap PR. Contract under test: NEVER throws,
// budget/abort semantics match runtime.ts patterns, IngestOutcome diagnostics
// map onto the turn row's distill field (null outcome → no write at all),
// snapshots are durable either way, frames are stream-open-only, and
// digest.alreadyRecalled is populated from the accumulator view.

import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'
import { useObservability } from '@/lib/test/doubles/observability'

import type { IngestOutcome, MemoryProvider, TurnDigest } from './types'
import type * as dbActual from '@/lib/db'

class Fake {
  docs: Record<string, unknown>[] = []
  private m(f: Record<string, unknown>) {
    return this.docs.find((d) => Object.entries(f).every(([k, v]) => d[k] === v))
  }
  async findOne(f: Record<string, unknown>) {
    return this.m(f) ?? null
  }
  async updateOne(
    f: Record<string, unknown>,
    u: { $set?: Record<string, unknown>; $setOnInsert?: Record<string, unknown> },
    o?: { upsert?: boolean },
  ) {
    const hit = this.m(f)

    if (hit) {
      Object.assign(hit, u.$set ?? {})

      return { upsertedCount: 0 }
    }
    if (o?.upsert) {
      this.docs.push({ ...(u.$setOnInsert ?? {}), ...(u.$set ?? {}) })

      return { upsertedCount: 1 }
    }

    return { upsertedCount: 0 }
  }
  async createIndex() {
    return ''
  }
}
const byName = new Map<string, Fake>()
const coll = (name: string) => {
  let c = byName.get(name)

  if (!c) {
    c = new Fake()
    byName.set(name, c)
  }

  return c
}

useDb({
  db: (() => ({ collection: coll })) as unknown as typeof dbActual.db,
})

const logged: { level: string; event: string; fields?: Record<string, unknown> }[] = []
const errors: { event: string }[] = []

useObservability({
  logEvent: (level, event, fields) => {
    logged.push({ level, event, fields })
  },
  logError: (event) => {
    errors.push({ event })
  },
})

const { dispatchTurnIngest } = await import('./ingest-dispatch')

const snapshots = () => coll('memory_runtime_ingest_events').docs
const turns = () => coll('memory_runtime_turns').docs

const makeProvider = (
  onTurnFinished: (
    digest: TurnDigest,
    opts: { signal: AbortSignal },
  ) => Promise<IngestOutcome | null>,
): MemoryProvider => ({
  meta: { id: 'native', displayName: 'Test', dataResidency: 'local', spiVersion: 1 },
  collectionPrefix: 'memory_native_',
  setup: async () => {},
  availability: async () => ({ state: 'ready' }),
  ingest: { onTurnFinished },
})

const active = (provider: MemoryProvider) =>
  ({ kind: 'active', provider, providerId: provider.meta.id, source: 'global' }) as const

const makeDigest = (over: Partial<TurnDigest> = {}): TurnDigest => ({
  conversationId: 'sess-1',
  userId: 'u1',
  teamId: 't1',
  origin: 'user',
  messages: [
    { role: 'user', content: 'we always deploy through the canary pipeline first' },
    { role: 'assistant', content: 'Understood.' },
  ],
  planId: null,
  startedAt: '2026-07-25T00:00:00.000Z',
  finishedAt: '2026-07-25T00:00:05.000Z',
  ...over,
})

// recordTurnDistillOutcome is a plain update (no upsert): capture writes the
// row first in production — mirror that here.
const seedTurnRow = () =>
  turns().push({ conversationId: 'sess-1', turnKey: 'req-1', distill: 'skipped_disabled' })

const sinks = (over: Record<string, unknown> = {}) => ({ turnKey: 'req-1', ...over })

describe('dispatchTurnIngest', () => {
  beforeEach(() => {
    // Recreate, don't just empty: the fail-open test below replaces this
    // collection's updateOne with a throwing one and cannot restore it (the
    // instance is shared through `coll`'s cache). Clearing only `docs` leaves
    // that patch live, so every later test that expects a snapshot silently
    // gets none — invisible in the default order, where that test runs last,
    // and 1-3 failures under `bun test --randomize`.
    byName.clear()
    logged.length = 0
    errors.length = 0
    seedTurnRow()
  })

  test('disabled resolution → no provider call, no writes', async () => {
    await dispatchTurnIngest(
      { kind: 'disabled', providerId: 'gone', reason: 'unregistered' },
      makeDigest(),
      sinks(),
    )
    expect(snapshots()).toHaveLength(0)
    expect(turns()[0]!.distill).toBe('skipped_disabled')
  })

  test('provider without an ingest slot → nothing (absence is the capability signal)', async () => {
    const provider = makeProvider(async () => ({ saved: [] }))

    delete (provider as { ingest?: unknown }).ingest
    await dispatchTurnIngest(active(provider), makeDigest(), sinks())
    expect(snapshots()).toHaveLength(0)
  })

  test('null outcome → no snapshot, no distill write (flag-off must stay invisible)', async () => {
    await dispatchTurnIngest(active(makeProvider(async () => null)), makeDigest(), sinks())
    expect(snapshots()).toHaveLength(0)
    expect(turns()[0]!.distill).toBe('skipped_disabled')
  })

  test('saved outcome → snapshot + distill mapped + frame emitted with the auto-ingest eventId', async () => {
    const frames: Record<string, unknown>[] = []
    const outcome: IngestOutcome = {
      saved: [
        {
          id: 'm1',
          scope: 'team',
          kind: 'record',
          title: 'Canary first',
          action: 'created',
          type: 'fact',
          text: 'Deploys go through canary first',
          categories: ['deploy', 'auto-learned'],
          createdAt: '2026-07-25T00:00:05.000Z',
          updatedAt: '2026-07-25T00:00:05.000Z',
        },
      ],
      status: 'completed',
      diagnostics: { outcome: 'saved' },
    }

    await dispatchTurnIngest(
      active(makeProvider(async () => outcome)),
      makeDigest(),
      sinks({ emitFrame: (frame: Record<string, unknown>) => frames.push(frame) }),
    )
    expect(snapshots()).toHaveLength(1)
    expect(snapshots()[0]).toMatchObject({
      provider: 'native',
      conversationId: 'sess-1',
      turnKey: 'req-1',
    })
    expect(turns()[0]!.distill).toBe('saved')
    expect(frames).toHaveLength(1)
    expect(frames[0]!.eventId).toBe('sess-1:auto-ingest:m1')
    expect(frames[0]!.type).toBe('memory-ingest')
  })

  test('reported supersede → runtime records the negative signal keyed by its turnKey', async () => {
    // The provider tombstones the record but cannot record the correction: the
    // turnKey the signal is keyed by lives in this layer. Without this the
    // supersede would silently vanish from every retention score, which is the
    // exact reason the store used to refuse team supersede at all.
    const outcome: IngestOutcome = {
      saved: [{ id: 'new-1', scope: 'team', title: 'Corrected belief', action: 'created' }],
      status: 'completed',
      diagnostics: { outcome: 'saved', supersededMemoryId: 'old-1', supersededScope: 'team' },
    }

    await dispatchTurnIngest(active(makeProvider(async () => outcome)), makeDigest(), sinks())

    const signals = coll('memory_runtime_attributions').docs

    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      memoryId: 'old-1',
      scope: 'team',
      conversationId: 'sess-1',
      turnKey: 'req-1',
      provider: 'native',
    })
    // The write itself must still be reported normally.
    expect(turns()[0]!.distill).toBe('saved')
  })

  test('no supersede reported → no attribution signal is invented', async () => {
    const outcome: IngestOutcome = {
      saved: [{ id: 'new-1', scope: 'team', title: 'A belief', action: 'created' }],
      status: 'completed',
      diagnostics: { outcome: 'saved' },
    }

    await dispatchTurnIngest(active(makeProvider(async () => outcome)), makeDigest(), sinks())
    expect(coll('memory_runtime_attributions').docs).toHaveLength(0)
  })

  test('no emitFrame (stream closed) → snapshot still durable, no frame attempt', async () => {
    const outcome: IngestOutcome = {
      saved: [{ id: 'm1', scope: 'personal', title: 'T', action: 'created' }],
      diagnostics: { outcome: 'saved' },
    }

    await dispatchTurnIngest(active(makeProvider(async () => outcome)), makeDigest(), sinks())
    expect(snapshots()).toHaveLength(1)
  })

  test('every known diagnostics.outcome maps onto the turn row distill field', async () => {
    for (const o of [
      'saved',
      'deduped',
      'rejected',
      'no_learn',
      'skipped_short',
      'skipped_origin',
      'failed',
    ]) {
      byName.forEach((c) => {
        c.docs = []
      })
      seedTurnRow()
      await dispatchTurnIngest(
        active(makeProvider(async () => ({ saved: [], diagnostics: { outcome: o } }))),
        makeDigest(),
        sinks(),
      )
      expect(turns()[0]!.distill).toBe(o)
    }
  })

  test('unknown vendor diagnostics.outcome → snapshot yes, distill untouched (never branched on)', async () => {
    await dispatchTurnIngest(
      active(makeProvider(async () => ({ saved: [], diagnostics: { outcome: 'vendor_custom' } }))),
      makeDigest(),
      sinks(),
    )
    expect(snapshots()).toHaveLength(1)
    expect(turns()[0]!.distill).toBe('skipped_disabled')
  })

  test('rejected outcome logs the agent.memory.auto_ingest_rejected warn (parity with agent.ts)', async () => {
    await dispatchTurnIngest(
      active(
        makeProvider(async () => ({
          saved: [],
          diagnostics: { outcome: 'rejected', reason: 'secret-bearing content' },
        })),
      ),
      makeDigest(),
      sinks(),
    )
    const warn = logged.find((l) => l.event === 'agent.memory.auto_ingest_rejected')

    expect(warn).toBeDefined()
    expect(warn!.level).toBe('warn')
    expect(warn!.fields).toMatchObject({ session_id: 'sess-1', reason: 'secret-bearing content' })
  })

  test('provider-controlled rejection reason is redacted and capped before telemetry', async () => {
    await dispatchTurnIngest(
      active(
        makeProvider(async () => ({
          saved: [],
          diagnostics: {
            outcome: 'rejected',
            // A refusal that echoes the refused content — the exact leak shape.
            reason: `contains api_key=sk-live-verysecret1234 ${'x'.repeat(400)}`,
          },
        })),
      ),
      makeDigest(),
      sinks(),
    )
    const warn = logged.find((l) => l.event === 'agent.memory.auto_ingest_rejected')
    const reason = warn!.fields!.reason as string

    expect(reason).not.toContain('sk-live-verysecret1234')
    expect(reason).toContain('[REDACTED:')
    expect(reason.length).toBeLessThanOrEqual(300)
  })

  test("only action:'created' saved events render frames — corrections and drafts do not", async () => {
    const frames: Record<string, unknown>[] = []

    await dispatchTurnIngest(
      active(
        makeProvider(async () => ({
          saved: [
            { id: 'a1', scope: 'personal', title: 'kept', action: 'created' },
            {
              id: 'a2',
              scope: 'personal',
              title: 'revised',
              action: 'updated',
              supersededId: 'a0',
            },
            { id: 'a3', scope: 'team', title: 'proposal', action: 'drafted' },
            { id: 'a4', scope: 'personal', title: 'gone', action: 'deleted' },
          ],
        })),
      ),
      makeDigest(),
      sinks({ emitFrame: (frame: Record<string, unknown>) => frames.push(frame) }),
    )
    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({ eventId: 'sess-1:auto-ingest:a1' })
  })

  test('populates digest.alreadyRecalled from the accumulator view', async () => {
    let seen: string[] | undefined
    const provider = makeProvider(async (digest) => {
      seen = digest.alreadyRecalled

      return null
    })

    await dispatchTurnIngest(
      active(provider),
      makeDigest(),
      sinks({
        view: { alreadyRecalled: ['OOM triage', 'kubectl preference'] },
      }),
    )
    expect(seen).toEqual(['OOM triage', 'kubectl preference'])
  })

  test('savedTitles fold into the hint after recalled labels, without dupes (same-turn dedup)', async () => {
    let seen: string[] | undefined
    const provider = makeProvider(async (digest) => {
      seen = digest.alreadyRecalled

      return null
    })

    await dispatchTurnIngest(
      active(provider),
      makeDigest(),
      sinks({
        view: {
          alreadyRecalled: ['OOM triage'],
          // 'OOM triage' also explicitly saved this turn — folded once.
          savedTitles: ['Prefers canary deploys', 'OOM triage'],
        },
      }),
    )
    expect(seen).toEqual(['OOM triage', 'Prefers canary deploys'])
  })

  test('no view → digest.alreadyRecalled defaults to empty, never undefined', async () => {
    let seen: string[] | undefined

    await dispatchTurnIngest(
      active(
        makeProvider(async (digest) => {
          seen = digest.alreadyRecalled

          return null
        }),
      ),
      makeDigest(),
      sinks(),
    )
    expect(seen).toEqual([])
  })

  test('throwing provider → resolves, logs, no snapshot (never throws into the caller)', async () => {
    await expect(
      dispatchTurnIngest(
        active(
          makeProvider(async () => {
            throw new Error('vendor exploded')
          }),
        ),
        makeDigest(),
        sinks(),
      ),
    ).resolves.toBeUndefined()
    expect(errors.some((e) => e.event === 'memory.ingest.failed')).toBe(true)
    expect(snapshots()).toHaveLength(0)
  })

  test('budget trip: hung provider is abandoned with a signal abort and a budget log', async () => {
    let aborted = false
    const provider = makeProvider(
      (_digest, opts) =>
        new Promise((resolve) => {
          opts.signal.addEventListener('abort', () => {
            aborted = true
            resolve(null)
          })
        }),
    )

    await dispatchTurnIngest(active(provider), makeDigest(), sinks({ budgetMs: 20 }))
    expect(aborted).toBe(true)
    expect(errors.some((e) => e.event === 'memory.ingest.budget_exceeded')).toBe(true)
    expect(snapshots()).toHaveLength(0)
  })

  test('snapshot-store failure after a good outcome still resolves (fail-open end to end)', async () => {
    // Patches the cached instance, so it must not outlive this test — the
    // beforeEach above recreates the collections for exactly that reason.
    const broken = coll('memory_runtime_ingest_events') as unknown as {
      updateOne: () => Promise<never>
    }

    broken.updateOne = async () => {
      throw new Error('mongo down')
    }
    await expect(
      dispatchTurnIngest(
        active(makeProvider(async () => ({ saved: [], diagnostics: { outcome: 'no_learn' } }))),
        makeDigest(),
        sinks(),
      ),
    ).resolves.toBeUndefined()
    expect(errors.length).toBeGreaterThan(0)
  })
})
