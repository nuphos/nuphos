import {
  runtimeBackgroundRunning,
  runtimeSnapshotFresh,
  runtimeTurnActive,
} from '../../../lib/runtimeExecution.ts'

import type { RuntimeExecution } from '../../../lib/runtimeExecution.ts'

export type ThreadStatus = 'loading' | 'running' | 'waiting' | 'done' | 'stopped' | 'unavailable'

export function threadStatusOf(snapshot: RuntimeExecution | undefined): ThreadStatus {
  if (!snapshot) return 'loading'
  // A turn that still reads as active but whose snapshot went stale may be running: unknown, not done.
  if (snapshot.state === 'active' && !runtimeSnapshotFresh(snapshot)) return 'loading'
  if (runtimeTurnActive(snapshot)) {
    // A pending request is the turn itself; only a permission prompt waits on a person.
    return (snapshot.permissionWaits ?? 0) > 0 ? 'waiting' : 'running'
  }

  return snapshot.state === 'interrupted' || snapshot.state === 'disconnected' ? 'stopped' : 'done'
}

/**
 * Work may still be in flight, background tools included, so the sidebar keeps
 * the thread out of its parent's "N done" fold. A thread with no snapshot at all
 * reads as settled there: a thread the runtime never reported on isn't running.
 */
export function threadRunning(snapshot: RuntimeExecution | undefined): boolean {
  if (!snapshot) return false
  const status = threadStatusOf(snapshot)

  return (
    status === 'running' ||
    status === 'waiting' ||
    status === 'loading' ||
    runtimeBackgroundRunning(snapshot)
  )
}
