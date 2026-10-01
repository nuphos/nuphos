import { describe, expect, test } from 'bun:test'

import { buildAuditEvent } from './event'
import { sealInventory, sealOnce, segmentBodyKey, segmentManifestKey } from './sealer'
import { verifySegment, GENESIS_SEGMENT_HASH } from './segment'

import type { JournalDoc } from './append'
import type { SealStateDoc, SealerDeps } from './sealer'
import type { SignedSegmentManifest } from './segment'
import type { AuditEvent } from './types'
import type { Collection } from 'mongodb'

const ACTOR = { userId: 'user-1', teamId: 'team-1' }

function makeChain(sessionId: string, count: number): JournalDoc[] {
  const docs: JournalDoc[] = []

  for (let seq = 1; seq <= count; seq++) {
    const event = buildAuditEvent({
      eventId: `turn_start|${sessionId}|req-${String(seq)}`,
      seq,
      ts: '2026-07-02T09:00:00.000Z',
      type: 'turn_start',
      actor: ACTOR,
      session: {
        conversationId: sessionId,
        requestId: `req-${String(seq)}`,
        streamId: 'stream-1',
        toolCallId: null,
        modelId: 'model-x',
      },
      payload: { note: seq },
      prevHash: docs.at(-1)?.entryHash,
    })

    // Every doc carries a display copy; sealed bodies must never include it.
    docs.push({
      ...event,
      sessionId,
      contentHot: [{ type: 'text', text: `secret-ish display ${String(seq)}` }],
    })
  }

  return docs
}

class FakeJournal {
  constructor(public docs: JournalDoc[]) {}

  aggregate<T>(pipeline: Record<string, unknown>[]) {
    const group = pipeline.find((stage) => '$group' in stage)?.$group as Record<string, unknown>
    const usesLast = JSON.stringify(group).includes('$last')
    const bySession = new Map<string, JournalDoc[]>()

    for (const doc of [...this.docs].sort((a, b) => a.seq - b.seq)) {
      const rows = bySession.get(doc.sessionId) ?? []

      rows.push(doc)
      bySession.set(doc.sessionId, rows)
    }
    const rows = [...bySession.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([sessionId, docs]) => {
        const tail = docs.at(-1)!

        return usesLast
          ? { _id: sessionId, maxSeq: tail.seq, headHash: tail.entryHash }
          : { _id: sessionId, maxSeq: tail.seq }
      })

    return { toArray: async () => rows as T[] }
  }

  find(filter: { sessionId: string; seq?: { $gt?: number; $gte?: number; $lte?: number } }) {
    let rows = this.docs.filter((doc) => doc.sessionId === filter.sessionId)

    if (filter.seq?.$gt !== undefined) rows = rows.filter((doc) => doc.seq > filter.seq!.$gt!)
    if (filter.seq?.$gte !== undefined) rows = rows.filter((doc) => doc.seq >= filter.seq!.$gte!)
    if (filter.seq?.$lte !== undefined) rows = rows.filter((doc) => doc.seq <= filter.seq!.$lte!)
    let sorted = rows
    let limited = rows.length
    const chain = {
      sort: (spec: { seq: number }) => {
        sorted = [...rows].sort((a, b) => (spec.seq === 1 ? a.seq - b.seq : b.seq - a.seq))

        return chain
      },
      limit: (n: number) => {
        limited = n

        return chain
      },
      toArray: async () => sorted.slice(0, limited).map((doc) => structuredClone(doc)),
    }

    return chain
  }

  asCollection() {
    return this as unknown as SealerDeps['journal']
  }
}

class FakeState {
  docs = new Map<string, SealStateDoc>()

  async findOne(filter: { _id: string }) {
    return structuredClone(this.docs.get(filter._id) ?? null)
  }

  async updateOne(
    filter: { _id: string } & Record<string, unknown>,
    update: { $set?: Record<string, unknown>; $setOnInsert?: Record<string, unknown> },
    options?: { upsert?: boolean },
  ) {
    const existing = this.docs.get(filter._id)
    const matches =
      existing !== undefined &&
      Object.entries(filter).every(([key, value]) => {
        if (key === '_id') return true
        const current = (existing as Record<string, unknown>)[key]

        if (value === null) return current === null || current === undefined

        return JSON.stringify(current) === JSON.stringify(value)
      })

    if (matches && existing) {
      Object.assign(existing, update.$set ?? {})

      return { matchedCount: 1, upsertedCount: 0 }
    }
    if (options?.upsert && existing === undefined) {
      const doc = { _id: filter._id, ...(update.$setOnInsert ?? {}), ...(update.$set ?? {}) }

      this.docs.set(filter._id, doc as SealStateDoc)

      return { matchedCount: 0, upsertedCount: 1 }
    }

    return { matchedCount: 0, upsertedCount: 0 }
  }

  asCollection() {
    return this as unknown as Collection<SealStateDoc>
  }
}

function makeDeps(journal: FakeJournal) {
  const objects = new Map<string, string>()
  const state = new FakeState()
  const deps: SealerDeps = {
    journal: journal.asCollection(),
    state: state.asCollection(),
    putObject: async (key, body) => {
      objects.set(key, typeof body === 'string' ? body : Buffer.from(body).toString('utf8'))
    },
    objectExists: async (key) => objects.has(key),
    sign: async (manifestHash) => ({
      alg: 'ECDSA_SHA_256',
      keyId: 'test-key',
      signatureBase64: Buffer.from(manifestHash, 'hex').toString('base64'),
    }),
    now: () => new Date('2026-07-02T10:00:00.000Z'),
  }

  return { deps, objects, state }
}

function manifestFor(objects: Map<string, string>, segmentId: string): SignedSegmentManifest {
  return JSON.parse(objects.get(segmentManifestKey(segmentId))!) as SignedSegmentManifest
}

describe('sealOnce', () => {
  test('seals unsealed events, uploads verifiable body+manifest, advances watermarks', async () => {
    const journal = new FakeJournal([...makeChain('conv-a', 3), ...makeChain('conv-b', 2)])
    const { deps, objects, state } = makeDeps(journal)

    const result = await sealOnce(deps)

    expect(result.segmentId).toBe('seg-00000001')
    expect(result.eventCount).toBe(5)

    const signed = manifestFor(objects, 'seg-00000001')
    const body = objects.get(segmentBodyKey('seg-00000001'))!

    expect(verifySegment({ signed, body, expectedPrevSegmentHash: GENESIS_SEGMENT_HASH })).toEqual(
      [],
    )
    expect(signed.signature?.keyId).toBe('test-key')
    // Hash-only WORM: the display copy present on every hot doc must not seal.
    expect(body).not.toContain('contentHot')
    expect(body).not.toContain('secret-ish display')
    expect((await state.findOne({ _id: 's:conv-a' }))?.sealedThrough).toBe(3)

    // Nothing new: no segment.
    const idle = await sealOnce(deps)

    expect(idle.segmentId).toBeNull()
  })

  test('subsequent segments chain prevSegmentHash and only cover new events', async () => {
    const journal = new FakeJournal(makeChain('conv-a', 2))
    const { deps, objects } = makeDeps(journal)

    await sealOnce(deps)

    journal.docs.push(...makeChain('conv-a', 4).slice(2))
    const second = await sealOnce(deps)

    expect(second.segmentId).toBe('seg-00000002')

    const first = manifestFor(objects, 'seg-00000001')
    const seg2 = manifestFor(objects, 'seg-00000002')

    expect(seg2.manifest.prevSegmentHash).toBe(first.manifestHash)
    expect(seg2.manifest.coverage).toEqual([{ sessionId: 'conv-a', fromSeq: 3, toSeq: 4 }])
  })

  test('a crash between claim and upload is recovered deterministically', async () => {
    const journal = new FakeJournal(makeChain('conv-a', 3))
    const { deps, objects, state } = makeDeps(journal)

    // First attempt dies mid-upload (after the claim, before any object lands).
    const crashingDeps: SealerDeps = {
      ...deps,
      putObject: async () => {
        throw new Error('simulated crash during upload')
      },
    }

    await expect(sealOnce(crashingDeps)).rejects.toThrow('simulated crash')
    expect((await state.findOne({ _id: '__global__' }))?.pending?.segmentId).toBe('seg-00000001')
    expect(objects.size).toBe(0)

    // Next run recovers the same segment id with identical content.
    const recovered = await sealOnce(deps)

    expect(recovered.recoveredPending).toBe(true)
    expect(recovered.segmentId).toBe('seg-00000001')
    const signed = manifestFor(objects, 'seg-00000001')
    const body = objects.get(segmentBodyKey('seg-00000001'))!

    expect(verifySegment({ signed, body, expectedPrevSegmentHash: GENESIS_SEGMENT_HASH })).toEqual(
      [],
    )
    expect((await state.findOne({ _id: '__global__' }))?.pending).toBeNull()
    expect((await state.findOne({ _id: 's:conv-a' }))?.sealedThrough).toBe(3)

    // Numbering continues cleanly afterwards.
    journal.docs.push(...makeChain('conv-a', 4).slice(3))
    const next = await sealOnce(deps)

    expect(next.segmentId).toBe('seg-00000002')
  })

  test('maxEvents caps a segment; the remainder ships in the next one', async () => {
    const journal = new FakeJournal(makeChain('conv-a', 5))
    const { deps } = makeDeps(journal)
    const first = await sealOnce(deps, { maxEvents: 3 })

    expect(first.eventCount).toBe(3)
    const second = await sealOnce(deps, { maxEvents: 3 })

    expect(second.eventCount).toBe(2)
  })
})

describe('sealInventory', () => {
  test('snapshots every conversation head into the same segment chain', async () => {
    const journal = new FakeJournal([...makeChain('conv-a', 3), ...makeChain('conv-b', 1)])
    const { deps, objects } = makeDeps(journal)

    await sealOnce(deps)

    const inventory = await sealInventory(deps)

    expect(inventory.segmentId).toBe('seg-00000002')
    const signed = manifestFor(objects, 'seg-00000002')

    expect(signed.manifest.kind).toBe('inventory')
    const prev = manifestFor(objects, 'seg-00000001')

    expect(signed.manifest.prevSegmentHash).toBe(prev.manifestHash)
    const body = objects.get(segmentBodyKey('seg-00000002'))!

    expect(body).toContain('conv-a')
    expect(body).toContain('conv-b')
    expect(verifySegment({ signed, body, expectedPrevSegmentHash: prev.manifestHash })).toEqual([])
  })
})
