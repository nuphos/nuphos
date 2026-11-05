// Revokes conversation tokens before they expire (#1378).
//
// - A token is revoked by its `jti`, and every token exchanged from it (the
//   `token_links` chain) goes with it.
// - Archiving a conversation revokes every token its session and its threads
//   were issued up to that moment; tokens minted after a restore are unaffected.
//
// Every record carries a TTL on the latest moment a matching token could still
// be valid, so the collections only ever hold live revocations.
import { db } from '@/lib/db'
import { logEvent } from '@/lib/observability'

type RevokedToken = { _id: string; expiresAt: Date; reason: string; revokedAt: Date }
type TokenLink = { _id: string; parentJti: string; expiresAt: Date }
type RevokedSession = { _id: string; before: number; expiresAt: Date; reason: string }

/** Longest a conversation token can live (24h), plus slack for clock skew. */
const MAX_TOKEN_LIFETIME_MS = 25 * 60 * 60 * 1000
/** How long one replica trusts a lookup; a revocation reaches every replica within this. */
const CACHE_MS = 5_000

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

  cache.set(key, { value, until: Date.now() + CACHE_MS })

  return value
}

/** Test hook. */
export function clearRevocationCacheForTest(): void {
  cache.clear()
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

/** Whether a verified conversation token has been revoked. */
export async function isTokenRevoked(claims: {
  jti?: string
  sid: string
  iat: number
}): Promise<boolean> {
  const { jti } = claims
  const [byJti, sessionCutoff] = await Promise.all([
    jti
      ? cached(`jti:${jti}`, async () => (await revokedTokens().countDocuments({ _id: jti })) > 0)
      : false,
    cached(
      `sid:${claims.sid}`,
      async () => (await revokedSessions().findOne({ _id: claims.sid }))?.before ?? null,
    ),
  ])

  return byJti || (sessionCutoff !== null && claims.iat <= sessionCutoff)
}
