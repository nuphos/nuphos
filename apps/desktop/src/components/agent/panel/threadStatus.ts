import { runtimeTurnActive } from '../../../lib/runtimeExecution.ts'

import type { RuntimeExecution } from '../../../lib/runtimeExecution.ts'

export type ThreadStatus = 'loading' | 'running' | 'waiting' | 'done' | 'stopped' | 'unavailable'

export function threadStatusOf(snapshot: RuntimeExecution | undefined): ThreadStatus {
  if (!snapshot) return 'loading'
  if (runtimeTurnActive(snapshot)) {
    // A pending request is the turn itself; only a registered request a person answers waits on one.
    return snapshot.requests?.some((request) => request.kind !== 'client-tool')
      ? 'waiting'
      : 'running'
  }

  return snapshot.state === 'interrupted' || snapshot.state === 'disconnected' ? 'stopped' : 'done'
}
