// The Boxes whose host restarts at this window's request, by device id. The request is made
// from a Box card or an agent's runtime card; the Boxes list of the Box's team settles each
// one as it reloads.
import { useSyncExternalStore } from 'react'

import { boxRestartStep } from './boxRestartPresentation.ts'

import type { BoxRestart, BoxRestartKind, BoxRestartOutcome } from './boxRestartPresentation.ts'
import type { AgentDevice } from '../../api/device-types'

type TrackedRestart = BoxRestart & { teamId: string }

let restarts: ReadonlyMap<string, TrackedRestart> = new Map()
const listeners = new Set<() => void>()

function set(next: ReadonlyMap<string, TrackedRestart>): void {
  restarts = next
  for (const listener of listeners) listener()
}

export const boxRestarts = {
  subscribe: (listener: () => void) => {
    listeners.add(listener)

    return () => {
      listeners.delete(listener)
    }
  },
  current: () => restarts,
  start: (deviceId: string, teamId: string, kind: BoxRestartKind, now = Date.now()) =>
    set(new Map(restarts).set(deviceId, { teamId, kind, startedAt: now, sawOffline: false })),
  /** Moves the team's restarts on with its fresh list; returns the ones that ended. */
  settle: (devices: AgentDevice[], teamId: string, now = Date.now()) => {
    const next = new Map(restarts)
    let changed = false
    const ended: {
      device: AgentDevice | undefined
      kind: BoxRestartKind
      outcome: BoxRestartOutcome
    }[] = []

    for (const [deviceId, restart] of restarts) {
      // Another team's list does not list this Box; that does not end its restart.
      if (restart.teamId !== teamId) continue
      const device = devices.find((candidate) => candidate.deviceId === deviceId)
      const step = boxRestartStep(restart, device, now)

      if (step.outcome === 'restarting') next.set(deviceId, { ...restart, ...step.restart })
      else {
        next.delete(deviceId)
        ended.push({ device, kind: restart.kind, outcome: step.outcome })
      }
      changed ||= step.outcome !== 'restarting' || step.restart.sawOffline !== restart.sawOffline
    }
    if (changed) set(next)

    return ended
  },
}

/** This window's restart of the Box, while one is underway. */
export function useBoxRestart(deviceId: string): BoxRestart | undefined {
  return useSyncExternalStore(boxRestarts.subscribe, boxRestarts.current).get(deviceId)
}
