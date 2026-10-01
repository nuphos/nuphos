import { beforeEach, describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import { renameConversation, updateConversationTitle } from './db'

import type * as dbActual from '@/lib/db'

class FakeConversations {
  docs: Record<string, unknown>[] = []
  async updateOne(filter: Record<string, unknown>, update: { $set?: Record<string, unknown> }) {
    const matches = (doc: Record<string, unknown>, query: Record<string, unknown>): boolean =>
      Object.entries(query).every(([key, value]) => {
        if (key === '$or')
          return (value as Record<string, unknown>[]).some((part) => matches(doc, part))
        if (value && typeof value === 'object') {
          if ('$ne' in value) return doc[key] !== value.$ne
          if ('$exists' in value) return key in doc === value.$exists
        }

        return doc[key] === value
      })
    const match = this.docs.find((doc) => matches(doc, filter))

    if (!match) return { matchedCount: 0 }
    Object.assign(match, update.$set ?? {})

    return { matchedCount: 1 }
  }
}

const convs = new FakeConversations()

useDb({ db: () => ({ collection: () => convs }) })

describe('updateConversationTitle', () => {
  beforeEach(() => {
    convs.docs = [{ sessionId: 's1', userId: 'u1', title: 'Grafana alert delivery for rul...' }]
  })

  test('stores a generated title', async () => {
    expect(await updateConversationTitle('s1', 'u1', '  Sandbox pod loss alert  ')).toBe(true)
    expect(convs.docs[0]!.title).toBe('Sandbox pod loss alert')
  })

  // AI title generation can return '' (output budget exhausted before any text).
  // Writing it through blanks the insert-time title, and every reader then falls
  // back to the raw first message.
  test('refuses to blank an existing title', async () => {
    expect(await updateConversationTitle('s1', 'u1', '')).toBe(false)
    expect(await updateConversationTitle('s1', 'u1', '   \n ')).toBe(false)
    expect(convs.docs[0]!.title).toBe('Grafana alert delivery for rul...')
  })
})

describe('manual conversation titles', () => {
  beforeEach(() => {
    convs.docs = [{ sessionId: 's1', userId: 'owner', teamId: 'team', title: 'Original' }]
  })

  test('a trimmed manual title survives a late generated title', async () => {
    expect(await renameConversation('s1', 'owner', 'team', '  Incident review  ')).toBe(true)
    expect(await updateConversationTitle('s1', 'owner', 'Generated title')).toBe(false)
    expect(convs.docs[0]?.title).toBe('Incident review')
    expect(await renameConversation('s1', 'owner', 'team', 'Follow-up')).toBe(true)
  })

  test('a teammate or another team cannot rename a conversation', async () => {
    expect(await renameConversation('s1', 'teammate', 'team', 'Wrong')).toBe(false)
    expect(await renameConversation('s1', 'owner', 'other-team', 'Wrong')).toBe(false)
    expect(convs.docs[0]?.title).toBe('Original')
  })

  test('rejects empty and oversized titles without changing the stored title', async () => {
    expect(await renameConversation('s1', 'owner', 'team', '  ')).toBe(false)
    expect(await renameConversation('s1', 'owner', 'team', 'x'.repeat(121))).toBe(false)
    expect(convs.docs[0]?.title).toBe('Original')
  })
})
