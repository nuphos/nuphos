import { db } from '@/lib/db'
import { logError, logEvent } from '@/lib/observability'

import { apnsCredentials, isDeadToken, sendApns } from './apns'

import type { ApnsCredentials, ApnsEnvironment, ApnsRequest, ApnsResponse } from './apns'
import type { SessionExecutionState } from '@/lib/claude-code-preview/runtime-execution-snapshot'
import type { Collection } from 'mongodb'

/** Must match `TurnActivityAttributes.Phase` in the iOS app. */
export type LiveActivityPhase = 'running' | 'approval' | 'done' | 'stopped'

export type LiveActivityToken = { token: string; userId: string; environment: ApnsEnvironment }

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
  /** Null unless the session has a Live Activity and its phase changed. */
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
  await collection.createIndex(
    { updatedAt: 1 },
    { expireAfterSeconds: LIVE_ACTIVITY_TTL_SECONDS, name: 'live_activity_ttl' },
  )
}

export const liveActivityStore: LiveActivityStore = {
  async setPhase(sessionId, phase) {
    return sessions().findOneAndUpdate(
      { sessionId, phase: { $ne: phase } },
      { $set: { phase, updatedAt: new Date() } },
      { returnDocument: 'after' },
    )
  },
  async addToken(sessionId, token, row) {
    await sessions().updateOne({ sessionId }, { $pull: { tokens: { token: token.token } } })
    const session = await sessions().findOneAndUpdate(
      { sessionId },
      { $push: { tokens: token }, $set: { ...row, updatedAt: new Date() } },
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
}

// How long the card stays on the Lock Screen once nothing runs.
export const LIVE_ACTIVITY_DISMISS_S = 30 * 60
// Rows on the card; the rest are counted.
export const LIVE_ACTIVITY_ROWS = 3
// Resends after a throttled or failed APNs request.
export const LIVE_ACTIVITY_RETRY_MS = [5_000, 30_000, 120_000]

/** The status the app shows for this runtime state (iOS `AgentThreadBadge`).
 *  Null when the runtime cannot say: the card keeps what it last showed. */
export function liveActivityPhase(state: SessionExecutionState): LiveActivityPhase | null {
  if (state.schemaVersion !== 2 || state.state === 'disconnected' || state.state === 'unsupported')
    return null
  if (state.phase === 'resume_disconnected') return 'stopped'
  if ((state.permissionWaits ?? 0) > 0) return 'approval'
  if (state.state === 'active' || state.phase === 'background_tools') return 'running'

  return 'done'
}

export type LiveActivityDeps = {
  credentials: () => ApnsCredentials | null
  liveActivities: LiveActivityStore
  send: (credentials: ApnsCredentials, request: ApnsRequest) => Promise<ApnsResponse>
  now: () => number
  schedule: (work: () => void, delayMs: number) => void
}

const isActive = (phase?: LiveActivityPhase) =>
  !phase || phase === 'running' || phase === 'approval'

/** Must match `TurnActivityAttributes.ContentState` in the iOS app. A session
 *  registered before its run reported a phase is running. */
export function liveActivityCard(sessions: LiveActivitySession[]) {
  return {
    sessions: sessions.slice(0, LIVE_ACTIVITY_ROWS).map((s) => ({
      id: s.sessionId,
      teamId: s.teamId ?? '',
      title: s.title ?? '',
      phase: s.phase ?? 'running',
    })),
    more: Math.max(0, sessions.length - LIVE_ACTIVITY_ROWS),
    active: sessions.filter((s) => isActive(s.phase)).length,
  }
}

/** Sends each token its whole card. While anything on it runs or waits for
 *  approval the card updates; otherwise it ends. A token is dropped only once
 *  it has ended or APNs says it is dead; anything else is retried, so a
 *  throttled end still reaches the phone, unless the phase changed meanwhile
 *  (its own delivery covers those tokens). */
async function deliver(
  deps: LiveActivityDeps,
  session: LiveActivitySession,
  tokens: LiveActivityToken[],
  attempt = 0,
): Promise<void> {
  const credentials = deps.credentials()

  if (!credentials) return
  const now = Math.floor(deps.now() / 1000)
  const retry: LiveActivityToken[] = []

  await Promise.all(
    tokens.map(async (token) => {
      try {
        const card = liveActivityCard(await deps.liveActivities.forToken(token.token))
        const ends = card.active === 0
        const response = await deps.send(credentials, {
          deviceToken: token.token,
          environment: token.environment,
          pushType: 'liveactivity',
          payload: {
            aps: {
              timestamp: now,
              event: ends ? 'end' : 'update',
              'content-state': card,
              ...(ends ? { 'dismissal-date': now + LIVE_ACTIVITY_DISMISS_S } : {}),
            },
          },
        })

        if (isDeadToken(response) || (ends && response.status === 200)) {
          await deps.liveActivities.removeToken(token.token)
        } else if (response.status !== 200) {
          logEvent('warn', 'push.live_activity.rejected', {
            status: response.status,
            reason: response.reason ?? null,
            attempt,
          })
          retry.push(token)
        }
      } catch (error) {
        logError('push.live_activity.send_failed', error, {
          session_id: session.sessionId,
          attempt,
        })
        retry.push(token)
      }
    }),
  )
  const delay = LIVE_ACTIVITY_RETRY_MS[attempt]

  if (retry.length > 0 && delay !== undefined) {
    deps.schedule(() => {
      void retryIfCurrent(deps, session, retry, attempt + 1).catch((error: unknown) => {
        logError('push.live_activity_failed', error)
      })
    }, delay)
  }
}

async function retryIfCurrent(
  deps: LiveActivityDeps,
  session: LiveActivitySession,
  tokens: LiveActivityToken[],
  attempt: number,
): Promise<void> {
  const current = await deps.liveActivities.get(session.sessionId)

  if (!current || current.phase !== session.phase) return
  const registered = tokens.filter((t) => current.tokens.some((c) => c.token === t.token))

  if (registered.length > 0) await deliver(deps, current, registered, attempt)
}

/** Puts a session on an activity's card and brings that card up to the
 *  runtime's current state (a turn can end before the phone gets a token).
 *  The token is stored first, so a state arriving meanwhile either sees it or
 *  is the one read here. */
export async function registerLiveActivityToken(
  deps: LiveActivityDeps,
  sessionId: string,
  token: LiveActivityToken,
  row: LiveActivityRow,
  state: SessionExecutionState | null,
): Promise<void> {
  const added = await deps.liveActivities.addToken(sessionId, token, row)
  const phase = state && liveActivityPhase(state)
  const changed = phase ? await deps.liveActivities.setPhase(sessionId, phase) : null

  if (changed) await deliver(deps, changed, changed.tokens)
  else if (added.phase && added.phase !== 'running') await deliver(deps, added, [token])
}

/** Moves the session's Live Activities to the runtime's newest state. */
export async function recordLiveActivityState(
  deps: LiveActivityDeps,
  sessionId: string,
  state: SessionExecutionState,
): Promise<void> {
  const phase = liveActivityPhase(state)
  const session = phase ? await deps.liveActivities.setPhase(sessionId, phase) : null

  if (session) await deliver(deps, session, session.tokens)
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

export function notifyLiveActivities(sessionId: string, state: SessionExecutionState): void {
  if (!apnsCredentials()) return
  void recordLiveActivityState(liveActivityDeps, sessionId, state).catch((error: unknown) => {
    logError('push.live_activity_failed', error)
  })
}
