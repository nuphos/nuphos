import { describe, expect, test } from 'bun:test'

import { JournalAppendError, JournalWriter } from './append'
import { buildAuditEvent, deriveEventId } from './event'
import { verifyConversationChain } from './verify'

import type { JournalAppendInput, JournalDoc } from './append'
import type { Collection } from 'mongodb'

// Minimal in-memory stand-in for the Mongo collection, enforcing the same two
// unique indexes the real ensureJournalIndexes() creates. Lets us exercise the
// optimistic-append race and crash semantics without a live mongod.
class FakeCollection {
  docs: JournalDoc[] = []
  /** Called right before each insert attempt — test hook to simulate races/crashes. */
  beforeInsert: ((doc: JournalDoc) => void) | null = null

  async findOne(
    filter: Record<string, unknown>,
    options?: { sort?: { seq: number } },
  ): Promise<JournalDoc | null> {
    let rows = this.docs.filter((doc) =>
      Object.entries(filter).every(
        ([key, value]) => (doc as Record<string, unknown>)[key] === value,
      ),
    )

    if (options?.sort?.seq === -1) rows = [...rows].sort((a, b) => b.seq - a.seq)

    return rows[0] ?? null
  }

  async insertOne(doc: JournalDoc): Promise<{ insertedId: string }> {
    this.beforeInsert?.(doc)
    this.insertRaw(doc)

    return { insertedId: doc.eventId }
  }

  /** Insert without hooks — used by tests to simulate a concurrent winner. */
  insertRaw(doc: JournalDoc): void {
    if (this.docs.some((d) => d.eventId === doc.eventId)) {
      throw Object.assign(new Error('E11000 duplicate key error: event_id_unique'), {
        code: 11000,
        keyPattern: { eventId: 1 },
      })
    }
    if (this.docs.some((d) => d.sessionId === doc.sessionId && d.seq === doc.seq)) {
      throw Object.assign(new Error('E11000 duplicate key error: session_seq_unique'), {
        code: 11000,
        keyPattern: { sessionId: 1, seq: 1 },
      })
    }
    this.docs.push(structuredClone(doc))
  }

  asCollection(): Collection<JournalDoc> {
    return this as unknown as Collection<JournalDoc>
  }
}

const ACTOR = { userId: 'user-1', teamId: 'team-1' }

function input(
  overrides: Partial<JournalAppendInput> & { toolCallId?: string } = {},
): JournalAppendInput {
  const toolCallId = overrides.toolCallId ?? 'call-1'
  const session = {
    conversationId: 'conv-1',
    requestId: 'req-1',
    streamId: 'stream-1',
    toolCallId,
    modelId: 'model-x',
  }

  return {
    eventId: deriveEventId('tool_call_intent', session),
    type: 'tool_call_intent',
    actor: ACTOR,
    session,
    payload: { toolName: 'bash', command: 'kubectl get pods' },
    ...overrides,
  }
}

describe('JournalWriter.append', () => {
  test('appends a verifiable chain across conversations', async () => {
    const fake = new FakeCollection()
    const writer = new JournalWriter(fake.asCollection())

    await writer.append(input({ toolCallId: 'call-1' }))
    await writer.append(input({ toolCallId: 'call-2' }))
    const other = input({ toolCallId: 'call-1' })

    other.session = { ...other.session, conversationId: 'conv-2' }
    other.eventId = deriveEventId('tool_call_intent', other.session)
    await writer.append(other)

    const conv1 = fake.docs.filter((d) => d.sessionId === 'conv-1')

    expect(conv1.map((d) => d.seq)).toEqual([1, 2])
    expect(verifyConversationChain(conv1).ok).toBe(true)
    expect(fake.docs.filter((d) => d.sessionId === 'conv-2').map((d) => d.seq)).toEqual([1])
  })

  test('idempotent retry: same eventId returns the stored event without appending', async () => {
    const fake = new FakeCollection()
    const writer = new JournalWriter(fake.asCollection())

    const first = await writer.append(input())
    const retry = await writer.append(input())

    expect(first.deduped).toBe(false)
    expect(retry.deduped).toBe(true)
    expect(retry.event.entryHash).toBe(first.event.entryHash)
    expect(fake.docs).toHaveLength(1)
  })

  test('losing a seq race retries against the new tail (no gap, chain intact)', async () => {
    const fake = new FakeCollection()
    const writer = new JournalWriter(fake.asCollection())

    // First insert attempt collides with a concurrent winner that grabbed seq 1.
    let raced = false

    fake.beforeInsert = (doc) => {
      if (raced) return
      raced = true
      const winner = input({ toolCallId: 'winner-call' })
      const winnerEvent = buildAuditEvent({
        eventId: winner.eventId,
        seq: doc.seq,
        ts: '2026-07-02T09:00:00.000Z',
        type: winner.type,
        actor: winner.actor,
        session: winner.session,
        payload: winner.payload,
      })

      fake.insertRaw({ ...winnerEvent, sessionId: 'conv-1' })
    }

    const result = await writer.append(input({ toolCallId: 'call-2' }))

    expect(result.event.seq).toBe(2)
    expect(fake.docs.map((d) => d.seq).sort((a, b) => a - b)).toEqual([1, 2])
    expect(verifyConversationChain(fake.docs.filter((d) => d.sessionId === 'conv-1')).ok).toBe(true)
  })

  test('a crash before insert leaves nothing behind — no permanent gap', async () => {
    const fake = new FakeCollection()
    const writer = new JournalWriter(fake.asCollection())

    await writer.append(input({ toolCallId: 'call-1' }))

    fake.beforeInsert = () => {
      throw new Error('network blip')
    }
    await expect(writer.append(input({ toolCallId: 'call-2' }))).rejects.toThrow('network blip')
    fake.beforeInsert = null

    // The failed append persisted nothing; the next append takes seq 2 cleanly.
    const next = await writer.append(input({ toolCallId: 'call-3' }))

    expect(next.event.seq).toBe(2)
    expect(verifyConversationChain(fake.docs).ok).toBe(true)
  })

  test('refuses to dedupe when the same eventId carries DIFFERENT content', async () => {
    const fake = new FakeCollection()
    const writer = new JournalWriter(fake.asCollection())

    await writer.append(input())

    const different = input()

    different.payload = { toolName: 'bash', command: 'rm -rf / # forged' }
    await expect(writer.append(different)).rejects.toThrow(/DIFFERENT content/)
    expect(fake.docs).toHaveLength(1)
  })

  test('gives up after exhausting retries against a pathological race', async () => {
    const fake = new FakeCollection()
    const writer = new JournalWriter(fake.asCollection())
    let counter = 0

    fake.beforeInsert = (doc) => {
      counter += 1
      fake.insertRaw({
        ...doc,
        eventId: `rival|${String(counter)}`,
        sessionId: 'conv-1',
      })
    }

    await expect(writer.append(input())).rejects.toThrow(JournalAppendError)
  })
})
