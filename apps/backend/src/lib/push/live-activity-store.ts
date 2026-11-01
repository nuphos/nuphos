import { db } from '@/lib/db'

import type { ApnsEnvironment } from './apns'
import type { Collection } from 'mongodb'

/** Must match `TurnActivityAttributes.Phase` in the iOS app. */
export type LiveActivityPhase = 'running' | 'approval' | 'done' | 'stopped' | 'unavailable'

export type LiveActivityToken = {
  token: string
  userId: string
  environment: ApnsEnvironment
  /** The phone showing the card; apps from before push-to-start leave it out. */
  deviceId?: string
  registeredAt?: Date
}

/** A conversation's runtime status and the Live Activities showing it.
 *  A phone has one activity for all its running conversations, so one token
 *  sits on every session that phone's card lists. */
export type LiveActivitySession = {
  sessionId: string
  /** The card's row: the conversation's team (for its link) and title. */
  teamId?: string
  title?: string
  phase?: LiveActivityPhase
  tokens: LiveActivityToken[]
  updatedAt: Date
}

export type LiveActivityRow = { teamId: string; title: string }

export type LiveActivityStore = {
  /** Null unless the phase changed. */
  setPhase: (sessionId: string, phase: LiveActivityPhase) => Promise<LiveActivitySession | null>
  addToken: (
    sessionId: string,
    token: LiveActivityToken,
    row: LiveActivityRow,
  ) => Promise<LiveActivitySession>
  /** Drops the token from every session: its activity is over. */
  removeToken: (token: string) => Promise<void>
  get: (sessionId: string) => Promise<LiveActivitySession | null>
  /** The sessions on one activity's card, most recently updated first. */
  forToken: (token: string) => Promise<LiveActivitySession[]>
  /** Every card token the user's phones registered. */
  tokensForUser: (userId: string) => Promise<LiveActivityToken[]>
}

// iOS ends an activity after 8 hours and removes it from the Lock Screen
// 4 hours later; nothing here is useful after that.
const LIVE_ACTIVITY_TTL_SECONDS = 12 * 60 * 60

const sessions = (): Collection<LiveActivitySession> =>
  db().collection<LiveActivitySession>('push_live_activity_sessions')

export async function setupLiveActivityIndexes(): Promise<void> {
  const collection = sessions()

  await collection.createIndex({ sessionId: 1 }, { unique: true, name: 'live_activity_session' })
  await collection.createIndex({ 'tokens.token': 1 }, { name: 'live_activity_token' })
  await collection.createIndex({ 'tokens.userId': 1 }, { name: 'live_activity_user' })
  await collection.createIndex(
    { updatedAt: 1 },
    { expireAfterSeconds: LIVE_ACTIVITY_TTL_SECONDS, name: 'live_activity_ttl' },
  )
}

export const liveActivityStore: LiveActivityStore = {
  // Every session keeps its phase, so a later watcher's card can join it the
  // moment it starts running.
  async setPhase(sessionId, phase) {
    const updatedAt = new Date()
    const before = await sessions().findOneAndUpdate(
      { sessionId },
      [
        {
          $set: {
            phase,
            tokens: { $ifNull: ['$tokens', []] },
            updatedAt: { $cond: [{ $eq: ['$phase', phase] }, '$updatedAt', updatedAt] },
          },
        },
      ],
      { upsert: true, returnDocument: 'before' },
    )

    if (before?.phase === phase) return null

    return { ...(before ?? { sessionId, tokens: [] }), phase, updatedAt }
  },
  async addToken(sessionId, token, row) {
    await sessions().updateOne({ sessionId }, { $pull: { tokens: { token: token.token } } })
    const session = await sessions().findOneAndUpdate(
      { sessionId },
      {
        $push: { tokens: { ...token, registeredAt: token.registeredAt ?? new Date() } },
        $set: { ...row, updatedAt: new Date() },
      },
      { upsert: true, returnDocument: 'after' },
    )

    return session!
  },
  async removeToken(token) {
    await sessions().updateMany({ 'tokens.token': token }, { $pull: { tokens: { token } } })
  },
  async get(sessionId) {
    return sessions().findOne({ sessionId })
  },
  async forToken(token) {
    return sessions().find({ 'tokens.token': token }).sort({ updatedAt: -1 }).toArray()
  },
  async tokensForUser(userId) {
    const listed = await sessions()
      .find({ 'tokens.userId': userId }, { projection: { tokens: 1 } })
      .toArray()
    const tokens = new Map(
      listed.flatMap((s) => s.tokens).filter((t) => t.userId === userId).map((t) => [t.token, t]),
    )

    return [...tokens.values()]
  },
}
