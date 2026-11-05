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
let onFind: (() => void) | undefined
let onBulkWrite: ((collection: string) => void) | undefined

function fakeCollection(name: string) {
  const docs = collections.get(name) ?? new Map<string, Doc>()

  collections.set(name, docs)
  type Update = { $set?: Record<string, unknown>; $max?: Record<string, number | Date> }
  const upsert = (id: string, update: Update) => {
    const doc: Doc = { ...(docs.get(id) ?? { _id: id }), ...update.$set }

    for (const [key, value] of Object.entries(update.$max ?? {})) {
      const current = doc[key] as number | Date | undefined

      if (current === undefined || +value > +current) doc[key] = value
    }
    docs.set(id, doc)
  }

  return {
    createIndex: async () => 'ok',
    updateOne: async (filter: { _id: string }, update: Update) => {
      upsert(filter._id, update)
    },
    bulkWrite: async (
      ops: {
        updateOne: { filter: { _id: string; before?: number }; update: Update; upsert?: boolean }
      }[],
    ) => {
      for (const { updateOne: op } of ops) {
        const doc = docs.get(op.filter._id)

        if (!doc && !op.upsert) continue
        if (op.filter.before !== undefined && doc?.before !== op.filter.before) continue
        upsert(op.filter._id, op.update)
      }
      onBulkWrite?.(name)
    },
    find: (filter: { parentJti: { $in: string[] } }) => ({
      toArray: async () =>
        onFind?.() ??
        [...docs.values()].filter((doc) => filter.parentJti.$in.includes(doc.parentJti as string)),
    }),
    updateMany: async (
      filter: { _id: { $in: string[] }; before: { $gte: number }; generation: number },
      update: Update,
    ) => {
      for (const id of filter._id.$in) {
        const doc = docs.get(id)

        if (
          doc &&
          (doc.before as number) >= filter.before.$gte &&
          doc.generation === filter.generation
        )
          upsert(id, update)
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
    await revokeSessionTokens(['conv-1'], 'archived', { 'conv-1': 1000 })
    await releaseRestoredSessions(['conv-1'], 1000)
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

  test('an older, overlapping session revocation never moves the cutoff back', async () => {
    await revokeSessionTokens(['conv-1'], 'archived')
    const cutoff = collections.get('revoked_conversation_sessions')?.get('conv-1')?.before as number
    const realNow = Date.now

    // A write captured a second earlier lands after the newer one.
    Date.now = () => realNow() - 1000
    try {
      await revokeSessionTokens(['conv-1'], 'archived')
    } finally {
      Date.now = realNow
    }
    expect(collections.get('revoked_conversation_sessions')?.get('conv-1')?.before).toBe(cutoff)
  })

  test('each level is revoked before its children are read', async () => {
    await recordTokenLink('c', 'p', now() + 60)
    const parentRevokedAtRead: boolean[] = []

    onFind = () => {
      parentRevokedAtRead.push(collections.get('revoked_conversation_tokens')?.has('p') ?? false)
    }
    try {
      await revokeToken('p', now() + 60, 'test')
    } finally {
      onFind = undefined
    }
    // An exchange that links a child after this read re-reads p and finds it revoked.
    expect(parentRevokedAtRead[0]).toBe(true)
    expect(collections.get('revoked_conversation_tokens')?.has('c')).toBe(true)
  })

  test('a restore releases only the cutoff of the archive it restored', async () => {
    await revokeSessionTokens(['conv-1'], 'archived', { 'conv-1': 1000 })
    // A newer archive on another replica lands before the restore's release.
    await revokeSessionTokens(['conv-1'], 'archived', { 'conv-1': 2000 })
    await releaseRestoredSessions(['conv-1'], 1000)
    expect(await isTokenRevoked({ jti: 'x', sid: 'conv-1', iat: now() }, true)).toBe(true)
  })

  test('a child minted while the first cutoff write was in flight is still revoked', async () => {
    const realNow = Date.now
    let writes = 0

    // The exchange's child is minted a second after the first write captured its cutoff.
    onBulkWrite = (collection) => {
      if (collection !== 'revoked_conversation_sessions') return
      writes++
      if (writes === 1) Date.now = () => realNow() + 1000
    }
    try {
      await revokeSessionTokens(['conv-1'], 'archived', { 'conv-1': 1000 })
    } finally {
      Date.now = realNow
      onBulkWrite = undefined
    }
    expect(writes).toBe(2)
    expect(await isTokenRevoked({ jti: 'child', sid: 'conv-1', iat: now() + 1 }, true)).toBe(true)
  })

  test('the second cutoff write never undoes a restore that landed in between', async () => {
    const realNow = Date.now

    onBulkWrite = (collection) => {
      if (collection !== 'revoked_conversation_sessions' || onBulkWrite === undefined) return
      onBulkWrite = undefined
      // The restore lands, then the clock moves on before the second write.
      void releaseRestoredSessions(['conv-1'], 1000).then(() => {
        Date.now = () => realNow() + 1000
      })
    }
    try {
      await revokeSessionTokens(['conv-1'], 'archived', { 'conv-1': 1000 })
      await new Promise((resolve) => setTimeout(resolve, 0))
    } finally {
      Date.now = realNow
      onBulkWrite = undefined
    }
    expect(await isTokenRevoked({ jti: 'restored', sid: 'conv-1', iat: now() }, true)).toBe(false)
  })
})
