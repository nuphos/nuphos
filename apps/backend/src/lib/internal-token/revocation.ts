// Revokes conversation tokens before they expire (#1378).
//
// - A token is revoked by its `jti`, and every token exchanged from it (the
//   `token_links` chain) goes with it.
// - Archiving a conversation revokes every token its session and its threads
//   were issued up to that moment; tokens minted after a restore are unaffected.
//
// Every record carries a TTL on the latest moment a matching token could still
// be valid, so the collections only ever hold live revocations.
//
// Tokens minted before #1374 carry no `jti`: they cannot be revoked one by one,
// and a token exchanged from one is not linked. Both share their session id,
// so the session cutoff (archiving) still reaches them.
import { db } from '@/lib/db'
import { logEvent } from '@/lib/observability'

type RevokedToken = { _id: string; expiresAt: Date; reason: string; revokedAt: Date }
type TokenLink = { _id: string; parentJti: string; expiresAt: Date }
type RevokedSession = { _id: string; before: number; expiresAt: Date; reason: string }

/** Longest a conversation token can live (24h), plus slack for clock skew. */
const MAX_TOKEN_LIFETIME_MS = 25 * 60 * 60 * 1000
/** How long one replica trusts a lookup; a revocation reaches every replica within this. */
const CACHE_MS = 5_000
/** Above this many entries, expired ones are swept before the next insert. */
const CACHE_SWEEP_AT = 5_000

const revokedTokens = () => db().collection<RevokedToken>('revoked_conversation_tokens')
const tokenLinks = () => db().collection<TokenLink>('conversation_token_links')
const revokedSessions = () => db().collection<RevokedSession>('revoked_conversation_sessions')

export async function setupTokenRevocationIndexes(): Promise<void> {
  await Promise.all([
    revokedTokens().createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, name: 'revoked_conversation_tokens_ttl' },
    ),
    tokenLinks().createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, name: 'conversation_token_links_ttl' },
    ),
    tokenLinks().createIndex({ parentJti: 1 }, { name: 'conversation_token_links_parent' }),
    revokedSessions().createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, name: 'revoked_conversation_sessions_ttl' },
    ),
  ])
}

const cache = new Map<string, { value: boolean | number | null; until: number }>()

async function cached<T extends boolean | number | null>(
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  const hit = cache.get(key)

  if (hit && hit.until > Date.now()) return hit.value as T
  const value = await load()

  if (cache.size >= CACHE_SWEEP_AT) {
    const now = Date.now()

    for (const [entry, { until }] of cache) if (until <= now) cache.delete(entry)
  }
  cache.set(key, { value, until: Date.now() + CACHE_MS })

  return value
}

/** Test hooks. */
export function clearRevocationCacheForTest(): void {
  cache.clear()
}

export function revocationCacheSizeForTest(): number {
  return cache.size
}

/** Records that `childJti` was exchanged from `parentJti`, so revoking the parent reaches it. */
export async function recordTokenLink(childJti: string, parentJti: string, exp: number) {
  await tokenLinks().updateOne(
    { _id: childJti },
    { $set: { parentJti, expiresAt: new Date(exp * 1000) } },
    { upsert: true },
  )
}

/** Revokes `jti` and every token exchanged from it, directly or through others. */
export async function revokeToken(jti: string, exp: number, reason: string): Promise<number> {
  const revokedAt = new Date()
  const expiresAt = new Date(exp * 1000)
  const seen = new Set([jti])
  let frontier = [jti]

  while (frontier.length > 0) {
    const children = await tokenLinks()
      .find({ parentJti: { $in: frontier } }, { projection: { _id: 1 } })
      .toArray()

    frontier = children.map((child) => child._id).filter((id) => !seen.has(id))
    for (const id of frontier) seen.add(id)
  }
  // A child never outlives its parent, so the parent's expiry bounds them all.
  await revokedTokens().bulkWrite(
    [...seen].map((id) => ({
      updateOne: {
        filter: { _id: id },
        update: { $set: { expiresAt, reason, revokedAt } },
        upsert: true,
      },
    })),
  )
  for (const id of seen) cache.delete(`jti:${id}`)
  logEvent('info', 'auth.conversation_token.revoked', { jti, reason, derived: seen.size - 1 })

  return seen.size
}

/**
 * Restoring an archived session within the second it was archived would leave
 * tokens minted after the restore at the cutoff's `iat`. Move such a cutoff one
 * second back: tokens from that same second before the archive stay valid, which
 * is the lesser risk than rejecting the restored conversation's own tokens.
 */
export async function releaseRestoredSessions(sessionIds: string[]): Promise<void> {
  if (sessionIds.length === 0) return
  const now = Math.floor(Date.now() / 1000)

  await revokedSessions().updateMany(
    { _id: { $in: sessionIds }, before: { $gte: now } },
    { $set: { before: now - 1 } },
  )
  for (const sid of sessionIds) cache.delete(`sid:${sid}`)
}

/** Revokes every token these sessions were issued up to now. */
export async function revokeSessionTokens(sessionIds: string[], reason: string): Promise<void> {
  if (sessionIds.length === 0) return
  const before = Math.floor(Date.now() / 1000)
  const expiresAt = new Date(Date.now() + MAX_TOKEN_LIFETIME_MS)

  await revokedSessions().bulkWrite(
    sessionIds.map((sid) => ({
      updateOne: {
        filter: { _id: sid },
        update: { $set: { before, expiresAt, reason } },
        upsert: true,
      },
    })),
  )
  for (const sid of sessionIds) cache.delete(`sid:${sid}`)
  logEvent('info', 'auth.conversation_session_tokens.revoked', {
    session_ids: sessionIds,
    reason,
  })
}

type RevocableClaims = { jti?: string; sid: string; iat: number }

const jtiRevoked = async (jti: string) => (await revokedTokens().countDocuments({ _id: jti })) > 0
const sessionCutoff = async (sid: string) =>
  (await revokedSessions().findOne({ _id: sid }))?.before ?? null

/**
 * Whether a verified conversation token has been revoked. `fresh` skips the
 * per-replica cache, for checks that must not act on a stale answer.
 */
export async function isTokenRevoked(claims: RevocableClaims, fresh = false): Promise<boolean> {
  const { jti, sid } = claims
  const [byJti, cutoff] = await Promise.all([
    jti ? (fresh ? jtiRevoked(jti) : cached(`jti:${jti}`, () => jtiRevoked(jti))) : false,
    fresh ? sessionCutoff(sid) : cached(`sid:${sid}`, () => sessionCutoff(sid)),
  ])

  return byJti || (cutoff !== null && claims.iat <= cutoff)
}

/**
 * Links a token exchanged from `subject`, then re-reads the subject's state
 * without the cache. A revocation that raced the exchange, whether by jti
 * (its link walk ran before this link existed) or by session (this child's
 * `iat` is past the cutoff), therefore still reaches the child.
 */
export async function inheritRevocation(
  child: { jti: string; exp: number },
  subject: RevocableClaims,
): Promise<boolean> {
  if (subject.jti) await recordTokenLink(child.jti, subject.jti, child.exp)
  if (!(await isTokenRevoked(subject, true))) return false
  await revokeToken(child.jti, child.exp, 'subject-revoked')

  return true
}
