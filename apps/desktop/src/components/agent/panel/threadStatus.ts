import { runtimeSnapshotFresh, runtimeTurnActive } from '../../../lib/runtimeExecution.ts'

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
