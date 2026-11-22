import { randomUUID } from 'node:crypto'

import { logEvent } from '@/lib/observability'

import type { TunnelConnection, TunnelHolderDeps } from './holder-types'
import type { LocalRuntimeStatus } from './protocol'

/** As long as Desktop 0.127.0 waits before it installs a staged update by itself. */
const RESTART_IDLE_MS = 10 * 60_000

/**
 * A Desktop before 0.127.0 installs a staged update only when it restarts, so one left running
 * never does (#4524). Once the computer has gone unused as long as 0.127.0 waits by itself, it
 * is asked once per update to restart into it; it refuses while an agent works (#2955).
 */
export function stagedUpdateRestarter(
  userId: string,
  deviceId: string,
  connection: Pick<TunnelConnection, 'send'>,
  deps: Pick<TunnelHolderDeps, 'stagedUpdateToRestart' | 'restartIdleMs'>,
  usedAt: () => number,
) {
  let asked: string | undefined

  return (status: LocalRuntimeStatus | undefined) => {
    const version = status && deps.stagedUpdateToRestart?.(status)

    if (!version || version === asked) return
    if (Date.now() - usedAt() < (deps.restartIdleMs ?? RESTART_IDLE_MS)) return
    asked = version
    const s = randomUUID()

    // Its answer comes back on a stream the holder does not hold, and is dropped.
    connection.send({ t: 'open', s, purpose: 'instances' })
    connection.send({ t: 'data', s, d: JSON.stringify({ method: 'update' }) })
    logEvent('info', 'agent.local_runtime.restart_into_update', {
      user_id: userId,
      device_id: deviceId,
      app_version: status.app?.version,
      update_version: version,
    })
  }
}
