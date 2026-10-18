import { db } from '@/lib/db'
import { logError, logEvent } from '@/lib/observability'

import { apnsCredentials, isDeadToken, sendApns } from './apns'
import { classifyTurn } from './turn-outcome'

import type { ApnsCredentials, ApnsEnvironment, ApnsRequest, ApnsResponse } from './apns'
import type { NotifiableRun } from './notify'
import type { TurnOutcome } from './turn-outcome'
import type { Collection } from 'mongodb'

/** An iOS Live Activity showing one conversation's turn. Any phone watching
 *  the conversation can start one, so activities are found by session. */
export type LiveActivity = {
  token: string
  userId: string
  sessionId: string
  environment: ApnsEnvironment
  createdAt: Date
}

export type LiveActivityStore = {
  register: (activity: Omit<LiveActivity, 'createdAt'>) => Promise<void>
  listForSession: (sessionId: string) => Promise<LiveActivity[]>
  removeToken: (token: string) => Promise<void>
}

// iOS ends an activity after 8 hours and removes it from the Lock Screen
// 4 hours later; its token is useless after that.
const LIVE_ACTIVITY_TTL_SECONDS = 12 * 60 * 60

const liveActivities = (): Collection<LiveActivity> =>
  db().collection<LiveActivity>('push_live_activities')

export async function setupLiveActivityIndexes(): Promise<void> {
  const collection = liveActivities()

  await collection.createIndex({ token: 1 }, { unique: true, name: 'live_activity_token_unique' })
  await collection.createIndex({ sessionId: 1 }, { name: 'live_activity_session' })
  await collection.createIndex(
    { createdAt: 1 },
    { expireAfterSeconds: LIVE_ACTIVITY_TTL_SECONDS, name: 'live_activity_ttl' },
  )
}

export const liveActivityStore: LiveActivityStore = {
  async register(activity) {
    await liveActivities().updateOne(
      { token: activity.token },
      { $set: activity, $setOnInsert: { createdAt: new Date() } },
      { upsert: true },
    )
  },
  async listForSession(sessionId) {
    return liveActivities().find({ sessionId }).toArray()
  },
  async removeToken(token) {
    await liveActivities().deleteOne({ token })
  },
}

// How long a finished turn stays on the Lock Screen.
export const LIVE_ACTIVITY_DISMISS_S = 30 * 60

/** Must match `TurnActivityAttributes.Phase` in the iOS app. */
export type LiveActivityPhase = 'running' | 'approval' | 'done' | 'failed' | 'stopped'

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
}

/** An approval updates the activity; every other phase ends it. Not
 *  coalesced like alerts: every turn end must reach the activity. */
export async function pushLiveActivityPhase(
  { credentials: configured, liveActivities: store, send, now: nowMs }: LiveActivityDeps,
  sessionId: string,
  phase: LiveActivityPhase,
): Promise<void> {
  const credentials = configured()

  if (!credentials) return
  const activities = await store.listForSession(sessionId)
  const ends = phase !== 'approval'
  const now = Math.floor(nowMs() / 1000)
  const payload = {
    aps: {
      timestamp: now,
      event: ends ? 'end' : 'update',
      'content-state': ends ? { phase, endedAt: now } : { phase },
      ...(ends ? { 'dismissal-date': now + LIVE_ACTIVITY_DISMISS_S } : {}),
    },
  }

  await Promise.all(
    activities.map(async (activity) => {
      try {
        const response = await send(credentials, {
          deviceToken: activity.token,
          environment: activity.environment,
          pushType: 'liveactivity',
          payload,
        })

        if (ends || isDeadToken(response)) await store.removeToken(activity.token)
        else if (response.status !== 200)
          logEvent('warn', 'push.live_activity.rejected', {
            status: response.status,
            reason: response.reason ?? null,
          })
      } catch (error) {
        logError('push.live_activity.send_failed', error, { session_id: sessionId })
      }
    }),
  )
}

const defaultDeps: LiveActivityDeps = {
  credentials: apnsCredentials,
  liveActivities: liveActivityStore,
  send: sendApns,
  now: Date.now,
}

/** Moves the conversation's Live Activities to where the turn now stands. */
export function notifyLiveActivities(run: NotifiableRun, event: 'approval' | 'ended'): void {
  const phase =
    event === 'approval'
      ? 'approval'
      : liveActivityPhase(
          classifyTurn({ ...run, aborted: run.abortController.signal.aborted }),
          run.abortController.signal.aborted,
        )

  if (!phase || !apnsCredentials()) return
  void pushLiveActivityPhase(defaultDeps, run.sessionId, phase).catch((error: unknown) => {
    logError('push.live_activity_failed', error)
  })
}
