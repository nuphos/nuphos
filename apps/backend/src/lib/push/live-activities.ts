import { getConversationBySessionId } from '@/lib/agent/db'
import { logError, logEvent } from '@/lib/observability'

import { apnsCredentials, isDeadToken, sendApns } from './apns'
import { beginLiveActivityStart, pushDeviceStore, takeLiveActivityPending } from './devices'
import { liveActivityStore } from './live-activity-store'
import { conversationTitle } from './notify'
import { watcherCanRead } from './watchers'

import type { ApnsCredentials, ApnsRequest, ApnsResponse } from './apns'
import type { PushDevice } from './devices'
import type {
  LiveActivityPhase,
  LiveActivityRow,
  LiveActivitySession,
  LiveActivityStore,
  LiveActivityToken,
} from './live-activity-store'
import type { PushConversation } from './notify'
import type { SessionExecutionState } from '@/lib/claude-code-preview/runtime-execution-snapshot'

export type {
  LiveActivityPhase,
  LiveActivityRow,
  LiveActivitySession,
  LiveActivityStore,
  LiveActivityToken,
} from './live-activity-store'

// How long the card stays on the Lock Screen once nothing runs.
export const LIVE_ACTIVITY_DISMISS_S = 30 * 60
// Rows on the card; the rest are counted.
export const LIVE_ACTIVITY_ROWS = 3
// Resends after a throttled or failed APNs request.
export const LIVE_ACTIVITY_RETRY_MS = [5_000, 30_000, 120_000]
// iOS ends a card 8 hours after it starts; an older token shows nothing.
export const LIVE_ACTIVITY_LIFETIME_MS = 8 * 60 * 60 * 1000

/** The status the app shows for this runtime state (iOS `AgentThreadBadge`). */
export function liveActivityPhase(state: SessionExecutionState): LiveActivityPhase {
  if (state.schemaVersion !== 2 || state.state === 'disconnected' || state.state === 'unsupported')
    return 'unavailable'
  if (state.phase === 'resume_disconnected') return 'stopped'
  if ((state.permissionWaits ?? 0) > 0) return 'approval'
  if (state.state === 'active' || state.phase === 'background_tools') return 'running'

  return 'done'
}

export type LiveActivityDeps = {
  credentials: () => ApnsCredentials | null
  liveActivities: LiveActivityStore
  send: (credentials: ApnsCredentials, request: ApnsRequest) => Promise<ApnsResponse>
  conversation: (sessionId: string) => Promise<PushConversation | null>
  canRead: (conversation: PushConversation, userId: string) => Promise<boolean>
  devices: (userId: string) => Promise<PushDevice[]>
  /** False while the phone waits for a card already started; `pending` then waits too. */
  startCard: typeof beginLiveActivityStart
  pendingRows: typeof takeLiveActivityPending
  now: () => number
  schedule: (work: () => void, delayMs: number) => void
}

const isActive = (phase?: LiveActivityPhase) =>
  !phase || phase === 'running' || phase === 'approval'
// An unavailable runtime may come back, and an ended card can no longer show it.
const isFinished = (phase?: LiveActivityPhase) => phase === 'done' || phase === 'stopped'

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

/** Sends each token its whole card. Once every row is done or stopped the
 *  card ends; until then it updates. A token is dropped only once
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
        const listed = await deps.liveActivities.forToken(token.token)
        const card = liveActivityCard(listed)
        const ends = listed.every((s) => isFinished(s.phase))
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
  // A card the backend started: conversations that ran while it came up join it.
  const pending = token.deviceId
    ? (await deps.pendingRows(token.userId, token.deviceId)).filter(
        (p) => p.sessionId !== sessionId,
      )
    : []

  for (const { sessionId: id, ...pendingRow } of pending)
    await deps.liveActivities.addToken(id, token, pendingRow)
  const changed = state
    ? await deps.liveActivities.setPhase(sessionId, liveActivityPhase(state))
    : null

  if (changed) await deliver(deps, changed, changed.tokens)
  else if (pending.length > 0 || (added.phase && added.phase !== 'running'))
    await deliver(deps, added, [token])
}

/** Puts a conversation that started running on each watcher's card: the one
 *  their phone shows, or, on a phone without one, a new card started over
 *  APNs. That card's token comes back through `registerLiveActivityToken`. */
async function join(deps: LiveActivityDeps, session: LiveActivitySession): Promise<void> {
  const credentials = deps.credentials()
  const conversation = credentials ? await deps.conversation(session.sessionId) : null

  if (!credentials || !conversation) return
  const row = { teamId: conversation.teamId ?? '', title: conversationTitle(conversation) }
  const listed = new Set(session.tokens.map((t) => t.token))
  const since = deps.now() - LIVE_ACTIVITY_LIFETIME_MS

  await Promise.all(
    (conversation.watcherIds ?? []).map(async (userId) => {
      if (!(await deps.canRead(conversation, userId))) return
      const cards = (await deps.liveActivities.tokensForUser(userId)).filter(
        (t) => (t.registeredAt?.getTime() ?? 0) > since,
      )

      for (const card of cards) {
        if (!listed.has(card.token))
          await deps.liveActivities.addToken(session.sessionId, card, row)
      }
      const starts = (await deps.devices(userId)).flatMap(({ deviceId, environment, ...d }) =>
        d.liveActivityStartToken && !cards.some((c) => c.deviceId === deviceId)
          ? [{ deviceId, deviceToken: d.liveActivityStartToken, environment }]
          : [],
      )

      await Promise.all(
        starts.map(async ({ deviceId, deviceToken, environment }) => {
          const pending = { sessionId: session.sessionId, ...row }

          if (!(await deps.startCard(userId, deviceId, pending))) return
          try {
            const response = await deps.send(credentials, {
              deviceToken,
              environment,
              pushType: 'liveactivity',
              payload: {
                aps: {
                  timestamp: Math.floor(deps.now() / 1000),
                  event: 'start',
                  'attributes-type': 'TurnActivityAttributes',
                  attributes: {},
                  'content-state': liveActivityCard([{ ...session, ...row }]),
                  alert: { title: row.title, body: 'Running' },
                },
              },
            })

            if (response.status !== 200) {
              logEvent('warn', 'push.live_activity.start_rejected', {
                status: response.status,
                reason: response.reason ?? null,
              })
            }
          } catch (error) {
            logError('push.live_activity.start_failed', error, { session_id: session.sessionId })
          }
        }),
      )
    }),
  )
}

/** Moves the session's Live Activities to the runtime's newest state. */
export async function recordLiveActivityState(
  deps: LiveActivityDeps,
  sessionId: string,
  state: SessionExecutionState,
): Promise<void> {
  const changed = await deps.liveActivities.setPhase(sessionId, liveActivityPhase(state))

  if (!changed) return
  if (!isActive(changed.phase)) return deliver(deps, changed, changed.tokens)
  await join(deps, changed)
  const session = (await deps.liveActivities.get(sessionId)) ?? changed

  await deliver(deps, session, session.tokens)
}

export const liveActivityDeps: LiveActivityDeps = {
  credentials: apnsCredentials,
  liveActivities: liveActivityStore,
  send: sendApns,
  conversation: getConversationBySessionId,
  canRead: (conversation, userId) => watcherCanRead(conversation, userId),
  devices: async (userId) =>
    (await pushDeviceStore.listForUser(userId)).filter((d) => d.platform === 'ios'),
  startCard: beginLiveActivityStart,
  pendingRows: takeLiveActivityPending,
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
