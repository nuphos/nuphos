import { beforeEach, describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import { normalizeConversationTriggerRun } from './conversation-trigger-run'
import { upsertConversationShell } from './db'

import type * as dbActual from '@/lib/db'

// The stamp is what moves a conversation out of Chats and into its Trigger's
// Runs list, and it is written exactly once — at creation. Everything after
// that is a later turn on the same conversation (the agent's own reply, or a
// teammate continuing the run from the Trigger page), and none of those know
// which trigger fired it. A stamp that lived in $set would be erased by the
// first such turn, dropping the run back into Chats with no way to get it back.

class FakeConversations {
  docs: Record<string, unknown>[] = []
  private matches(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
    return Object.entries(filter).every(([key, value]) => doc[key] === value)
  }
  async updateOne(
    filter: Record<string, unknown>,
    update: { $setOnInsert?: Record<string, unknown>; $set?: Record<string, unknown> },
    opts?: { upsert?: boolean },
  ) {
    const match = this.docs.find((doc) => this.matches(doc, filter))

    if (match) {
      Object.assign(match, update.$set ?? {})

      return { upsertedCount: 0 }
    }
    if (opts?.upsert) {
      this.docs.push({ ...(update.$setOnInsert ?? {}), ...(update.$set ?? {}) })

      return { upsertedCount: 1 }
    }

    return { upsertedCount: 0 }
  }
}

const convs = new FakeConversations()

useDb({ db: (() => ({ collection: () => convs })) as unknown as typeof dbActual.db })

const TRIGGER = '6512f0a1b2c3d4e5f6a7b8c9'

function storedMetadata() {
  return convs.docs[0]!.metadata as Record<string, unknown>
}

describe('upsertConversationShell trigger stamp', () => {
  beforeEach(() => {
    convs.docs = []
  })

  test('a conversation created without a trigger is not stamped', async () => {
    await upsertConversationShell({
      sessionId: 's1',
      userId: 'u1',
      title: 'T',
      firstMessage: 'hi',
      source: 'app',
    })

    expect(normalizeConversationTriggerRun(storedMetadata())).toBeNull()
  })

  test('a trigger-fired conversation records the trigger and how it fired', async () => {
    await upsertConversationShell({
      sessionId: 's1',
      userId: 'u1',
      title: 'T',
      firstMessage: 'Daily cost check',
      source: 'agent.trigger',
      trigger: { id: TRIGGER, kind: 'scheduled' },
    })

    expect(normalizeConversationTriggerRun(storedMetadata())).toEqual({
      id: TRIGGER,
      kind: 'scheduled',
    })
  })

  test('a Watch group run records which member it fired for', async () => {
    await upsertConversationShell({
      sessionId: 's1',
      userId: 'u1',
      title: 'T',
      firstMessage: 'Alert',
      source: 'agent.trigger',
      trigger: { id: TRIGGER, kind: 'webhook', memberKey: 'grafana:api-latency' },
    })

    expect(normalizeConversationTriggerRun(storedMetadata())).toEqual({
      id: TRIGGER,
      kind: 'webhook',
      memberKey: 'grafana:api-latency',
    })
  })

  test('a later turn on the same run cannot erase the stamp', async () => {
    await upsertConversationShell({
      sessionId: 's1',
      userId: 'u1',
      title: 'T',
      firstMessage: 'Daily cost check',
      source: 'agent.trigger',
      trigger: { id: TRIGGER, kind: 'scheduled' },
    })
    // A teammate replying inside the Trigger page: same session, no trigger
    // context, and the interactive source.
    await upsertConversationShell({
      sessionId: 's1',
      userId: 'u1',
      title: 'Daily cost check',
      firstMessage: 'Daily cost check',
      source: 'app',
    })

    expect(normalizeConversationTriggerRun(storedMetadata())).toEqual({
      id: TRIGGER,
      kind: 'scheduled',
    })
  })
})
