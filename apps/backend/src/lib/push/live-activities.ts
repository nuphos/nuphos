import { MongoServerError } from 'mongodb'

import { db } from '@/lib/db'
import { logError, logEvent } from '@/lib/observability'

import { apnsCredentials, isDeadToken, sendApns } from './apns'
import { classifyTurn } from './turn-outcome'

import type { ApnsCredentials, ApnsEnvironment, ApnsRequest, ApnsResponse } from './apns'
import type { NotifiableRun } from './notify'
import type { TurnOutcome } from './turn-outcome'
import type { Collection } from 'mongodb'

/** Must match `TurnActivityAttributes.Phase` in the iOS app. */
export type LiveActivityPhase = 'running' | 'approval' | 'done' | 'failed' | 'stopped'

export type LiveActivityToken = { token: string; userId: string; environment: ApnsEnvironment }

/** A conversation's newest turn phase and the iOS Live Activities showing it.
 *  Any phone watching the conversation can start one, so this is per session. */
export type LiveActivitySession = {
  sessionId: string
  phase?: LiveActivityPhase
  /** Unix seconds; set for the phases that end the activity. */
  endedAt?: number | null
  /** Orders writes: a run's start, approval and end, and later runs after earlier ones. */
  version?: number
  tokens: LiveActivityToken[]
  updatedAt: Date
}

export type LiveActivityStore = {
  /** Null when a newer phase is already stored. A run's start only updates a
   *  session that has a Live Activity; there is nothing to reset otherwise. */
  setPhase: (
    sessionId: string,
    phase: LiveActivityPhase,
    version: number,
    endedAt: number | null,
  ) => Promise<LiveActivitySession | null>
  addToken: (sessionId: string, token: LiveActivityToken) => Promise<LiveActivitySession>
  removeToken: (sessionId: string, token: string) => Promise<void>
}

// iOS ends an activity after 8 hours and removes it from the Lock Screen
// 4 hours later; nothing here is useful after that.
const LIVE_ACTIVITY_TTL_SECONDS = 12 * 60 * 60

const sessions = (): Collection<LiveActivitySession> =>
  db().collection<LiveActivitySession>('push_live_activity_sessions')

export async function setupLiveActivityIndexes(): Promise<void> {
  const collection = sessions()

  await collection.createIndex({ sessionId: 1 }, { unique: true, name: 'live_activity_session' })
  await collection.createIndex(
    { updatedAt: 1 },
    { expireAfterSeconds: LIVE_ACTIVITY_TTL_SECONDS, name: 'live_activity_ttl' },
  )
}

export const liveActivityStore: LiveActivityStore = {
  async setPhase(sessionId, phase, version, endedAt) {
    try {
      return await sessions().findOneAndUpdate(
        { sessionId, $or: [{ version: { $lt: version } }, { version: { $exists: false } }] },
        {
          $set: { phase, version, endedAt, updatedAt: new Date() },
          $setOnInsert: { tokens: [] },
        },
        { upsert: phase !== 'running', returnDocument: 'after' },
      )
    } catch (error) {
      // The filter missed an existing session holding a newer phase.
      if (error instanceof MongoServerError && error.code === 11000) return null
      throw error
    }
  },
  async addToken(sessionId, token) {
    await sessions().updateOne({ sessionId }, { $pull: { tokens: { token: token.token } } })
    const session = await sessions().findOneAndUpdate(
      { sessionId },
      { $push: { tokens: token }, $set: { updatedAt: new Date() } },
      { upsert: true, returnDocument: 'after' },
    )

    return session!
  },
  async removeToken(sessionId, token) {
    await sessions().updateOne({ sessionId }, { $pull: { tokens: { token } } })
  },
}

// How long a finished turn stays on the Lock Screen.
export const LIVE_ACTIVITY_DISMISS_S = 30 * 60
// Resends after a throttled or failed APNs request.
export const LIVE_ACTIVITY_RETRY_MS = [5_000, 30_000, 120_000]

/** A silent pause (the client resumes on its own) leaves the activity running. */
export function liveActivityPhase(
  outcome: TurnOutcome | null,
  aborted: boolean,
): LiveActivityPhase | null {
  if (!outcome) return aborted ? 'stopped' : null
  if (outcome.kind === 'finished') return 'done'

  return outcome.kind
}

export type LiveActivityDeps = {
  credentials: () => ApnsCredentials | null
  liveActivities: LiveActivityStore
  send: (credentials: ApnsCredentials, request: ApnsRequest) => Promise<ApnsResponse>
  now: () => number
  schedule: (work: () => void, delayMs: number) => void
}

/** Running and approval update the activity; every other phase ends it. A
 *  token is dropped only once it has ended or APNs says it is dead; anything
 *  else is retried, so a throttled end still reaches the phone. */
async function deliver(
  deps: LiveActivityDeps,
  session: LiveActivitySession,
  tokens: LiveActivityToken[],
  attempt = 0,
): Promise<void> {
  const credentials = deps.credentials()
  const { sessionId, phase, endedAt } = session

  if (!credentials || !phase) return
  const ends = phase !== 'running' && phase !== 'approval'
  const now = Math.floor(deps.now() / 1000)
  const payload = {
    aps: {
      timestamp: now,
      event: ends ? 'end' : 'update',
      'content-state': ends ? { phase, endedAt } : { phase },
      ...(ends ? { 'dismissal-date': now + LIVE_ACTIVITY_DISMISS_S } : {}),
    },
  }
  const retry: LiveActivityToken[] = []

  await Promise.all(
    tokens.map(async (token) => {
      try {
        const response = await deps.send(credentials, {
          deviceToken: token.token,
          environment: token.environment,
          pushType: 'liveactivity',
          payload,
        })

        if (isDeadToken(response) || (ends && response.status === 200)) {
          await deps.liveActivities.removeToken(sessionId, token.token)
        } else if (response.status !== 200) {
          logEvent('warn', 'push.live_activity.rejected', {
            status: response.status,
            reason: response.reason ?? null,
            attempt,
          })
          retry.push(token)
        }
      } catch (error) {
        logError('push.live_activity.send_failed', error, { session_id: sessionId, attempt })
        retry.push(token)
      }
    }),
  )
  const delay = LIVE_ACTIVITY_RETRY_MS[attempt]

  if (retry.length > 0 && delay !== undefined) {
    deps.schedule(() => {
      void deliver(deps, session, retry, attempt + 1).catch((error: unknown) => {
        logError('push.live_activity_failed', error)
      })
    }, delay)
  }
}

/** Stores the session's newest phase and pushes it to its activities. */
export async function recordLiveActivityPhase(
  deps: LiveActivityDeps,
  sessionId: string,
  phase: LiveActivityPhase,
  version: number,
): Promise<void> {
  const ends = phase !== 'running' && phase !== 'approval'
  const endedAt = ends ? Math.floor(deps.now() / 1000) : null
  const session = await deps.liveActivities.setPhase(sessionId, phase, version, endedAt)

  if (session) await deliver(deps, session, session.tokens)
}

/** Adds an activity's token and, when the turn already moved on (it can end
 *  before the phone gets a token), brings that activity up to date. The token
 *  is stored first, so a turn ending meanwhile either sees it or is seen here. */
export async function registerLiveActivityToken(
  deps: LiveActivityDeps,
  sessionId: string,
  token: LiveActivityToken,
): Promise<void> {
  const session = await deps.liveActivities.addToken(sessionId, token)

  if (session.phase && session.phase !== 'running') await deliver(deps, session, [token])
}

export const liveActivityDeps: LiveActivityDeps = {
  credentials: apnsCredentials,
  liveActivities: liveActivityStore,
  send: sendApns,
  now: Date.now,
  schedule: (work, delayMs) => {
    setTimeout(work, delayMs).unref()
  },
}

const EVENT_ORDER = { started: 0, approval: 1, ended: 2 } as const

/** Moves the conversation's Live Activities to where the run now stands. */
export function notifyLiveActivities(run: NotifiableRun, event: keyof typeof EVENT_ORDER): void {
  if (!apnsCredentials()) return
  const aborted = run.abortController.signal.aborted
  const phase =
    event === 'started'
      ? 'running'
      : event === 'approval'
        ? 'approval'
        : liveActivityPhase(classifyTurn({ ...run, aborted }), aborted)

  if (!phase) return
  void recordLiveActivityPhase(
    liveActivityDeps,
    run.sessionId,
    phase,
    run.createdAt * 4 + EVENT_ORDER[event],
  ).catch((error: unknown) => {
    logError('push.live_activity_failed', error)
  })
}
