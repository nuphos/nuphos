import { beforeEach, describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import {
  clearRevocationCacheForTest,
  isTokenRevoked,
  recordTokenLink,
  revokeSessionTokens,
  revokeToken,
} from './revocation'

type Doc = Record<string, unknown> & { _id: string }

// Just enough of a Mongo collection for the revocation module.
const collections = new Map<string, Map<string, Doc>>()

function fakeCollection(name: string) {
  const docs = collections.get(name) ?? new Map<string, Doc>()

  collections.set(name, docs)
  const upsert = (id: string, set: Record<string, unknown>) =>
    docs.set(id, { ...(docs.get(id) ?? { _id: id }), ...set })

  return {
    createIndex: async () => 'ok',
    updateOne: async (filter: { _id: string }, update: { $set: Record<string, unknown> }) => {
      upsert(filter._id, update.$set)
    },
    bulkWrite: async (
      ops: { updateOne: { filter: { _id: string }; update: { $set: Record<string, unknown> } } }[],
    ) => {
      for (const op of ops) upsert(op.updateOne.filter._id, op.updateOne.update.$set)
    },
    find: (filter: { parentJti: { $in: string[] } }) => ({
      toArray: async () =>
        [...docs.values()].filter((doc) => filter.parentJti.$in.includes(doc.parentJti as string)),
    }),
    countDocuments: async (filter: { _id: string }) => (docs.has(filter._id) ? 1 : 0),
    findOne: async (filter: { _id: string }) => docs.get(filter._id) ?? null,
  }
}

useDb({ db: () => ({ collection: fakeCollection }) as never })

const now = () => Math.floor(Date.now() / 1000)

beforeEach(() => {
  collections.clear()
  clearRevocationCacheForTest()
})

describe('token revocation', () => {
  test('a revoked token is rejected on its next check', async () => {
    const claims = { jti: 'a', sid: 'conv-1', iat: now() }

    expect(await isTokenRevoked(claims)).toBe(false)
    await revokeToken('a', now() + 60, 'test')
    expect(await isTokenRevoked(claims)).toBe(true)
    expect(await isTokenRevoked({ ...claims, jti: 'other' })).toBe(false)
  })

  test('revoking a parent revokes everything exchanged from it', async () => {
    await recordTokenLink('child', 'parent', now() + 60)
    await recordTokenLink('grandchild', 'child', now() + 60)
    await recordTokenLink('unrelated', 'someone-else', now() + 60)

    expect(await revokeToken('parent', now() + 60, 'test')).toBe(3)
    for (const jti of ['parent', 'child', 'grandchild']) {
      expect(await isTokenRevoked({ jti, sid: 'conv-1', iat: now() })).toBe(true)
    }
    expect(await isTokenRevoked({ jti: 'unrelated', sid: 'conv-1', iat: now() })).toBe(false)
  })

  test('revoking a session rejects its earlier tokens, not later ones', async () => {
    const issued = now() - 10

    await revokeSessionTokens(['conv-1', 'thread-1'], 'archived')
    expect(await isTokenRevoked({ jti: 'x', sid: 'conv-1', iat: issued })).toBe(true)
    expect(await isTokenRevoked({ sid: 'thread-1', iat: issued })).toBe(true)
    // Minted after a restore.
    expect(await isTokenRevoked({ jti: 'y', sid: 'conv-1', iat: now() + 5 })).toBe(false)
    expect(await isTokenRevoked({ jti: 'z', sid: 'conv-2', iat: issued })).toBe(false)
  })

  test('lookups are cached briefly, and a local revocation clears the cache', async () => {
    const claims = { jti: 'cached', sid: 'conv-1', iat: now() }

    expect(await isTokenRevoked(claims)).toBe(false)
    collections.get('revoked_conversation_tokens')?.set('cached', { _id: 'cached' })
    // Another replica's revocation: this replica's negative lookup is still cached.
    expect(await isTokenRevoked(claims)).toBe(false)
    await revokeToken('cached', now() + 60, 'test')
    expect(await isTokenRevoked(claims)).toBe(true)
  })
})
