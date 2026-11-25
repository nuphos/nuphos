import { logError, logEvent } from '@/lib/observability'

import { isDeadToken } from './apns'

import type { LiveActivityDeps } from './live-activities'
import type { LiveActivitySession, LiveActivityToken } from './live-activity-store'

// A card with nothing running stays up this long, so the next turn reuses it
// instead of starting a new one.
export const LIVE_ACTIVITY_IDLE_S = 30 * 60
// A card left with only unreachable runtimes ends sooner.
export const LIVE_ACTIVITY_OFFLINE_S = 10 * 60

/** Seconds a card with nothing running or waiting stays up; null otherwise.
 *  A session registered before its run reported a phase is running. */
export function idleWindow(listed: LiveActivitySession[]): number | null {
  if (listed.some((s) => !s.phase || s.phase === 'running' || s.phase === 'approval')) return null

  return listed.some((s) => s.phase === 'unavailable')
    ? LIVE_ACTIVITY_OFFLINE_S
    : LIVE_ACTIVITY_IDLE_S
}

/** What the card showed: any later change gives another one. */
const cardVersion = (listed: LiveActivitySession[]) =>
  JSON.stringify(listed.map((s) => [s.sessionId, s.phase ?? null, s.updatedAt.getTime()]))

/** Ends the card once it has sat idle for its window, unless it changed since:
 *  that change scheduled its own end. After a restart nothing is scheduled, and
 *  the `stale-date` sent with the update marks the card out of date instead. */
export function scheduleIdleEnd(
  deps: LiveActivityDeps,
  token: LiveActivityToken,
  listed: LiveActivitySession[],
  content: unknown,
  windowS: number,
): void {
  const version = cardVersion(listed)

  deps.schedule(() => {
    void endIfIdle(deps, token, version, content).catch((error: unknown) => {
      logError('push.live_activity.idle_end_failed', error)
    })
  }, windowS * 1000)
}

async function endIfIdle(
  deps: LiveActivityDeps,
  token: LiveActivityToken,
  version: string,
  content: unknown,
): Promise<void> {
  const credentials = deps.credentials()
  const listed = await deps.liveActivities.forToken(token.token)

  if (!credentials || listed.length === 0 || cardVersion(listed) !== version) return
  const now = Math.floor(deps.now() / 1000)
  const response = await deps.send(credentials, {
    deviceToken: token.token,
    environment: token.environment,
    pushType: 'liveactivity',
    priority: 5,
    payload: {
      aps: { timestamp: now, event: 'end', 'content-state': content, 'dismissal-date': now },
    },
  })

  if (response.status === 200 || isDeadToken(response)) {
    await deps.liveActivities.removeToken(token.token)
  } else {
    logEvent('warn', 'push.live_activity.idle_end_rejected', {
      status: response.status,
      reason: response.reason ?? null,
    })
  }
}

/** The phone's card was dismissed or ended: stop updating it, so the next
 *  turn starts a new one. Only the user's own tokens are dropped. */
export async function forgetLiveActivityToken(
  deps: Pick<LiveActivityDeps, 'liveActivities'>,
  userId: string,
  token: string,
): Promise<void> {
  const owned = await deps.liveActivities.tokensForUser(userId)

  if (owned.some((t) => t.token === token)) await deps.liveActivities.removeToken(token)
}
