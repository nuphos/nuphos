import type { LiveActivityPhase, LiveActivitySession } from './live-activity-store'

// Rows on the card; the rest are counted.
export const LIVE_ACTIVITY_ROWS = 3

/** Running or waiting for approval. A session registered before its run
 *  reported a phase is running. */
export const isActive = (phase?: LiveActivityPhase) =>
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
