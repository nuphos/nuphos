// Updates idle Boxes whose CLI does not update itself (#2104). From 0.28.0 the host installs a
// new release between turns; an older one waits for someone to click Update. Each minute one
// replica updates up to MAX_PER_SWEEP running Boxes nobody used for IDLE_MS whose agents are
// not mid-turn, each once per version: one whose update fails waits for its owner. A paused
// Box stays paused. A host that turned autoInstall off is left alone.

import { config } from '@/config'
import { boxAgentBusy, hostAgents, startBoxUpdate } from '@/lib/claude-code-preview/box-update'
import {
  newerRuntimeVersion,
  stableRuntimeVersion,
} from '@/lib/claude-code-preview/runtime-release'
import { logError, logEvent } from '@/lib/observability'
import { claimRun } from '@/lib/redis'

import { runningBoxes } from './box-free-sweep'
import { runOnBox } from './box-instabox'
import { BOX_UPDATE_COMMAND, downloadEnv, requireBackendUrl } from './box-instabox-client'
import { markBoxUpdateStarted } from './box-updating'
import { runtimePresenceStore } from './local-runtime/presence'

import type { RunningBox } from './box-free-sweep'
import type { LocalRuntimePresence } from './local-runtime/presence'
import type { LocalRuntimeStatus } from './local-runtime/protocol'

/** The first CLI that updates itself between turns. */
export const SELF_UPDATING_CLI = '0.28.0'
const SWEEP_MS = 60_000
const IDLE_MS = 10 * 60_000
const MAX_PER_SWEEP = 3
const ONCE_MS = 7 * 24 * 60 * 60_000

export type UpdateSweepDeps = {
  running: () => Promise<RunningBox[]>
  presence: (userId: string, deviceId: string) => Promise<LocalRuntimePresence | null>
  /** Whether one of the Box's agents is mid-turn. */
  busy: (teamId: string, box: RunningBox, status: LocalRuntimeStatus) => Promise<boolean>
  /** True the first time this device is updated to leave this version. */
  claim: (deviceId: string, version: string) => Promise<boolean>
  update: (box: RunningBox) => Promise<void>
}

// Without Redis (one replica) each claim would win again; this replica remembers its own.
const tried = new Set<string>()

export const boxUpdateSweepDeps: UpdateSweepDeps = {
  running: runningBoxes,
  presence: (userId, deviceId) => runtimePresenceStore().get(userId, deviceId),
  busy: async (teamId, box, status) => {
    for (const id of hostAgents(box, status))
      if (await boxAgentBusy(teamId, id, box.userId)) return true

    return false
  },
  claim: async (deviceId, version) => {
    const key = `agent:box-auto-update:${deviceId}:${version}`

    if (tried.has(key)) return false
    tried.add(key)

    return claimRun(key, ONCE_MS)
  },
  update: (box) =>
    startBoxUpdate(box, {
      // Not resumeBox: a paused Box stays paused, and the command fails.
      update: ({ userId, deviceId }) =>
        runOnBox(userId, deviceId, BOX_UPDATE_COMMAND, {
          ...downloadEnv(),
          NUPHOS_API_URL: requireBackendUrl(),
        }),
      markUpdating: ({ userId, deviceId }) => markBoxUpdateStarted(userId, deviceId),
    }),
}

/** The version to update from: one older than the one that updates itself, on a host that allows it. */
function outdated({ cliVersion, autoInstall }: LocalRuntimeStatus): string | undefined {
  return stableRuntimeVersion(cliVersion) &&
    newerRuntimeVersion(SELF_UPDATING_CLI, cliVersion) &&
    autoInstall !== false
    ? cliVersion
    : undefined
}

export async function sweepBoxUpdates(
  nowMs = Date.now(),
  deps = boxUpdateSweepDeps,
): Promise<void> {
  if (!config.box.instabox) return
  if (!(await claimRun('agent:box-update-sweep', SWEEP_MS - 5_000))) return
  let started = 0

  for (const box of await deps.running()) {
    if (started >= MAX_PER_SWEEP) return
    const { status, usedAt } = (await deps.presence(box.userId, box.deviceId)) ?? {}
    const version = status && outdated(status)

    if (!version || usedAt === undefined || nowMs - usedAt < IDLE_MS) continue
    if (await deps.busy(box.teamId, box, status)) continue
    if (!(await deps.claim(box.deviceId, version))) continue
    const fields = { team_id: box.teamId, device_id: box.deviceId, from_version: version }

    started++
    try {
      await deps.update(box)
      logEvent('info', 'agent.box.auto_update_started', fields)
    } catch (error) {
      logError('agent.box.auto_update_failed', error, fields)
    }
  }
}

/** Off with BOX_AUTO_UPDATE=false. */
export function startBoxUpdateSweep(): () => void {
  if (!config.box.autoUpdate) return () => {}
  let running = false
  const sweep = async () => {
    if (running) return
    running = true
    try {
      await sweepBoxUpdates()
    } catch (error) {
      logError('agent.box.update_sweep_failed', error)
    } finally {
      running = false
    }
  }
  const timer = setInterval(() => void sweep(), SWEEP_MS)

  timer.unref()

  return () => {
    clearInterval(timer)
  }
}
