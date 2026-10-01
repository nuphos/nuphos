import { beforeEach, describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import {
  bumpConversationActivity,
  conversationReadState,
  countUnreadConversations,
  markConversationRead,
} from './read-state'

import type * as dbActual from '@/lib/db'

type Doc = Record<string, unknown>

class FakeConversations {
  docs: Doc[] = []
  lastCountFilter: Doc | undefined
  private match(filter: Doc) {
    return this.docs.find((doc) =>
      Object.entries(filter).every(([key, value]) => key === '$or' || doc[key] === value),
    )
  }
  async findOne(filter: Doc) {
    return this.match(filter) ?? null
  }
  async updateOne(filter: Doc, update: { $inc?: Record<string, number> }) {
    const doc = this.match(filter)

    if (!doc) return { matchedCount: 0 }
    for (const [key, by] of Object.entries(update.$inc ?? {})) {
      doc[key] = ((doc[key] as number | undefined) ?? 0) + by
    }

    return { matchedCount: 1 }
  }
  async findOneAndUpdate(filter: Doc, update: { $max: Record<string, number> }) {
    const doc = this.match(filter)

    if (!doc) return null
    for (const [key, value] of Object.entries(update.$max)) {
      doc[key] = Math.max((doc[key] as number | undefined) ?? 0, value)
    }

    return doc
  }
  async countDocuments(filter: Doc) {
    this.lastCountFilter = filter

    return 2
  }
}

const conversations = new FakeConversations()

useDb({ db: (() => ({ collection: () => conversations })) as unknown as typeof dbActual.db })

beforeEach(() => {
  conversations.docs = [{ sessionId: 's', userId: 'owner', teamId: 't' }]
})

describe('conversation read state', () => {
  test('conversations without markers read as zero, not unread', () => {
    expect(conversationReadState({})).toEqual({ activitySeq: 0, readSeq: 0, unread: false })
    expect(conversationReadState({ activitySeq: 3, readSeq: 'x' })).toEqual({
      activitySeq: 3,
      readSeq: 0,
      unread: true,
    })
  })

  test('each turn boundary is new activity until the owner reads it', async () => {
    await bumpConversationActivity('s', 'owner')
    await bumpConversationActivity('s', 'owner')
    expect(conversationReadState(conversations.docs[0]!).unread).toBe(true)

    expect(await markConversationRead('s', 'owner', 't', 2)).toEqual({
      activitySeq: 2,
      readSeq: 2,
      unread: false,
    })
  })

  test('the marker never moves backwards or past recorded activity', async () => {
    conversations.docs[0]!.activitySeq = 5
    await markConversationRead('s', 'owner', 't', 4)
    expect(await markConversationRead('s', 'owner', 't', 1)).toMatchObject({ readSeq: 4 })
    expect(await markConversationRead('s', 'owner', 't', 99)).toMatchObject({
      readSeq: 5,
      unread: false,
    })
    await bumpConversationActivity('s', 'owner')
    expect(conversationReadState(conversations.docs[0]!)).toEqual({
      activitySeq: 6,
      readSeq: 5,
      unread: true,
    })
  })

  test('only the owner can move the marker', async () => {
    expect(await markConversationRead('s', 'teammate', 't', 1)).toBeNull()
  })

  test('the unread count covers the owner’s unarchived chats in one team', async () => {
    expect(await countUnreadConversations('owner', 't')).toBe(2)
    expect(conversations.lastCountFilter).toMatchObject({
      userId: 'owner',
      teamId: 't',
      archivedAt: { $exists: false },
      'metadata.trigger.id': { $exists: false },
    })
  })
})
