// Pauses free Boxes (box-free): one nobody used for IDLE_PAUSE_MS, and every running one of a
// team whose month's hours are used. A Box is used while data moves on its tunnel's streams
// (agent turns, commands, terminals, desktops), as the replica holding the tunnel records on
// its presence, or while one of its agents is mid-turn: a tool can run long without output.
// One replica sweeps each minute: two pausing the same Box raced, and usage was noted twice.

import { Sandbox } from '@insforge/instabox-sdk'
import { ObjectId } from 'mongodb'

import { config } from '@/config'
import { boxAgentBusy, hostAgents } from '@/lib/claude-code-preview/box-update'
import { teams } from '@/lib/identity/shared'
import { logError, logEvent } from '@/lib/observability'
import { claimRun } from '@/lib/redis'

import { IDLE_PAUSE_MS, freeAllowance, monthVcpuHours } from './box-free'
import { pauseBox } from './box-instabox'
import { QUICK_TIMEOUT_MS, connection } from './box-instabox-client'
import { noteBoxUsage } from './box-usage-history'
import { isRunning } from './box-vcpu'
import { runtimePresenceStore } from './local-runtime/presence'

const SWEEP_MS = 60_000

type RunningBox = { teamId: string; userId: string; deviceId: string }

export type FreeSweepDeps = {
  /** The deployment account's running Boxes; a team's own account has no allowance. */
  running: () => Promise<RunningBox[]>
  /** Of these teams, the ones whose plan sets their own limit. */
  subscribed: (teamIds: string[]) => Promise<Set<string>>
  monthVcpuHours: typeof monthVcpuHours
  usedAt: (userId: string, deviceId: string) => Promise<number | undefined>
  /** Whether one of the Box's agents is mid-turn. */
  busy: (teamId: string, userId: string, deviceId: string) => Promise<boolean>
  pause: (userId: string, deviceId: string) => Promise<unknown>
  noteUsage: (teamId: string) => void
}

const defaultDeps: FreeSweepDeps = {
  running: async () =>
    (await Sandbox.list(connection(QUICK_TIMEOUT_MS))).flatMap(({ state, metadata }) =>
      isRunning(state) && metadata.teamId && metadata.deviceId && metadata.createdBy
        ? [{ teamId: metadata.teamId, userId: metadata.createdBy, deviceId: metadata.deviceId }]
        : [],
    ),
  subscribed: async (teamIds) => {
    const found = await teams()
      .find(
        {
          _id: { $in: teamIds.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id)) },
          boxVcpuLimit: { $exists: true },
        },
        { projection: { _id: 1 } },
      )
      .toArray()

    return new Set(found.map((team) => team._id.toHexString()))
  },
  monthVcpuHours,
  usedAt: async (userId, deviceId) => (await runtimePresenceStore().get(userId, deviceId))?.usedAt,
  busy: async (teamId, userId, deviceId) => {
    const status = (await runtimePresenceStore().get(userId, deviceId))?.status

    for (const id of status ? hostAgents({ userId, deviceId }, status) : [])
      if (await boxAgentBusy(teamId, id, userId)) return true

    return false
  },
  pause: pauseBox,
  noteUsage: noteBoxUsage,
}

export async function sweepFreeBoxes(nowMs = Date.now(), deps = defaultDeps): Promise<void> {
  const allowance = freeAllowance()

  if (!allowance || !config.box.instabox) return
  if (!(await claimRun('agent:free-box-sweep', SWEEP_MS - 5_000))) return
  const byTeam = Map.groupBy(await deps.running(), (box) => box.teamId)
  const subscribed = await deps.subscribed([...byTeam.keys()])

  for (const [teamId, boxes] of byTeam) {
    if (subscribed.has(teamId)) continue
    // A fresh reading each sweep, so a missed pause or resume does not skew the hours.
    deps.noteUsage(teamId)
    const spent = (await deps.monthVcpuHours(teamId, nowMs)) >= allowance.vcpuHours

    for (const { userId, deviceId } of boxes) {
      // A Box whose host has not connected has no use recorded; the hours still bound it.
      const usedAt = spent ? undefined : await deps.usedAt(userId, deviceId)

      if (!spent && (usedAt === undefined || nowMs - usedAt < IDLE_PAUSE_MS)) continue
      if (!spent && (await deps.busy(teamId, userId, deviceId))) continue
      try {
        await deps.pause(userId, deviceId)
        logEvent('info', 'agent.box.free_paused', {
          team_id: teamId,
          device_id: deviceId,
          reason: spent ? 'hours' : 'idle',
        })
      } catch (error) {
        logError('agent.box.free_pause_failed', error, { team_id: teamId, device_id: deviceId })
      }
    }
  }
}

export function startFreeBoxSweep(): () => void {
  let running = false
  const sweep = async () => {
    if (running) return
    running = true
    try {
      await sweepFreeBoxes()
    } catch (error) {
      logError('agent.box.free_sweep_failed', error)
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
