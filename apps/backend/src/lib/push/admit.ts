// One push per conversation per window: a burst of turns (auto-continuations,
// quick follow-ups) collapses into the first, and the user is plainly around.
export const SESSION_COALESCE_MS = 20_000
export const USER_PUSHES_PER_MINUTE = 8

const USER_WINDOW_MS = 60_000

/** Whether a push may go now, per conversation and per user; in-process, like the notifier. */
export function createPushAdmitter(now: () => number) {
  const lastBySession = new Map<string, number>()
  const recentByUser = new Map<string, number[]>()
  let lastSweep = now()

  function sweep(at: number): void {
    if (at - lastSweep < USER_WINDOW_MS) return
    lastSweep = at
    for (const [key, last] of lastBySession) {
      if (at - last >= SESSION_COALESCE_MS) lastBySession.delete(key)
    }
    for (const [userId, times] of recentByUser) {
      if (times.every((time) => at - time >= USER_WINDOW_MS)) recentByUser.delete(userId)
    }
  }

  return {
    trackedKeys: () => lastBySession.size + recentByUser.size,
    admit: (userId: string, sessionId: string): boolean => {
      const at = now()
      const sessionKey = `${userId}:${sessionId}`
      const last = lastBySession.get(sessionKey)

      sweep(at)
      if (last !== undefined && at - last < SESSION_COALESCE_MS) return false
      const recent = (recentByUser.get(userId) ?? []).filter((time) => at - time < USER_WINDOW_MS)

      if (recent.length >= USER_PUSHES_PER_MINUTE) return false
      recent.push(at)
      recentByUser.set(userId, recent)
      lastBySession.set(sessionKey, at)

      return true
    },
  }
}
