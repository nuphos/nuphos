import { beforeEach, describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import {
  clearRevocationCacheForTest,
  inheritRevocation,
  isTokenRevoked,
  recordTokenLink,
  releaseRestoredSessions,
  revocationCacheSizeForTest,
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
    updateMany: async (
      filter: { _id: { $in: string[] }; before: { $gte: number } },
      update: { $set: Record<string, unknown> },
    ) => {
      for (const id of filter._id.$in) {
        const doc = docs.get(id)

        if (doc && (doc.before as number) >= filter.before.$gte) upsert(id, update.$set)
      }
    },
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

  test('an exchange that raced a revocation on another replica inherits it', async () => {
    const subject = { jti: 'parent', sid: 'conv-1', iat: now() }

    // This replica still has a cached "not revoked" for the subject.
    expect(await isTokenRevoked(subject)).toBe(false)
    collections.get('revoked_conversation_tokens')?.set('parent', { _id: 'parent' })
    expect(await isTokenRevoked(subject)).toBe(false)
    // The uncached re-read after linking catches it and revokes the child.
    expect(await inheritRevocation({ jti: 'child', exp: now() + 60 }, subject)).toBe(true)
    expect(await isTokenRevoked({ jti: 'child', sid: 'conv-1', iat: now() })).toBe(true)
  })

  test('an exchange after a session revocation inherits it too', async () => {
    const subject = { jti: 'p2', sid: 'conv-1', iat: now() - 10 }

    await revokeSessionTokens(['conv-1'], 'archived')
    // The child is minted after the cutoff, so only the link keeps it in reach.
    expect(await inheritRevocation({ jti: 'c2', exp: now() + 60 }, subject)).toBe(true)
    expect(await isTokenRevoked({ jti: 'c2', sid: 'conv-1', iat: now() + 5 })).toBe(true)
  })

  test('an exchange from a live subject only records the link', async () => {
    expect(
      await inheritRevocation({ jti: 'c3', exp: now() + 60 }, { jti: 'p3', sid: 's', iat: now() }),
    ).toBe(false)
    await revokeToken('p3', now() + 60, 'test')
    expect(await isTokenRevoked({ jti: 'c3', sid: 's', iat: now() })).toBe(true)
  })

  test('a restore in the second of its archive keeps the restored tokens valid', async () => {
    await revokeSessionTokens(['conv-1'], 'archived')
    await releaseRestoredSessions(['conv-1'])
    expect(await isTokenRevoked({ jti: 'fresh', sid: 'conv-1', iat: now() })).toBe(false)
    expect(await isTokenRevoked({ jti: 'old', sid: 'conv-1', iat: now() - 10 })).toBe(true)
  })

  test('expired cache entries are swept once the cache grows', async () => {
    for (let i = 0; i < 5000; i++)
      await isTokenRevoked({ jti: `t${String(i)}`, sid: 's', iat: now() })
    expect(revocationCacheSizeForTest()).toBeGreaterThanOrEqual(5000)
    const realNow = Date.now

    Date.now = () => realNow() + 10_000
    try {
      await isTokenRevoked({ jti: 'after', sid: 's2', iat: now() })
    } finally {
      Date.now = realNow
    }
    // Everything older than the cache window is gone; only the newest lookups remain.
    expect(revocationCacheSizeForTest()).toBeLessThanOrEqual(2)
  })
})
