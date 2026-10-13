import { beforeEach, describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import { setConversationParent } from './maintenance'

import type * as dbActual from '@/lib/db'

type Doc = Record<string, unknown>

class FakeConversations {
  docs: Doc[] = []
  private match(filter: Doc) {
    return this.docs.find((doc) =>
      Object.entries(filter).every(([key, value]) => key === '$or' || doc[key] === value),
    )
  }
  async findOne(filter: Doc) {
    return this.match(filter) ?? null
  }
  async updateOne(filter: Doc, update: { $set?: Doc; $unset?: Doc }) {
    const doc = this.match(filter)

    if (!doc) return { matchedCount: 0 }
    Object.assign(doc, update.$set)
    for (const key of Object.keys(update.$unset ?? {})) delete doc[key]

    return { matchedCount: 1 }
  }
}

const conversations = new FakeConversations()

useDb({ db: (() => ({ collection: () => conversations })) as unknown as typeof dbActual.db })

const parentOf = (sessionId: string) =>
  conversations.docs.find((doc) => doc.sessionId === sessionId)?.parentSessionId

beforeEach(() => {
  conversations.docs = [
    { sessionId: 'manager', userId: 'u', teamId: 't' },
    { sessionId: 'worker', userId: 'u', teamId: 't' },
    { sessionId: 'nested', userId: 'u', teamId: 't', parentSessionId: 'worker' },
    { sessionId: 'other-team', userId: 'u', teamId: 'x' },
    { sessionId: 'other-user', userId: 'v', teamId: 't' },
  ]
})

describe('setConversationParent', () => {
  test('nests a conversation under another one of the same owner and team', async () => {
    expect(await setConversationParent('worker', 'u', 't', 'manager')).toBe('ok')
    expect(parentOf('worker')).toBe('manager')
  })

  test('null unlinks', async () => {
    expect(await setConversationParent('nested', 'u', 't', null)).toBe('ok')
    expect(parentOf('nested')).toBeUndefined()
  })

  test('rejects itself, a descendant, and conversations outside the owner and team', async () => {
    for (const parent of ['worker', 'nested', 'other-team', 'other-user', 'missing']) {
      expect(await setConversationParent('worker', 'u', 't', parent)).toBe('invalid_parent')
    }
    expect(parentOf('worker')).toBeUndefined()
  })

  test('reports a conversation the caller does not own', async () => {
    expect(await setConversationParent('other-user', 'u', 't', 'manager')).toBe('not_found')
    expect(await setConversationParent('other-user', 'u', 't', null)).toBe('not_found')
  })
})
